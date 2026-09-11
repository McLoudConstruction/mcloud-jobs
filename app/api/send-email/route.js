import nodemailer from 'nodemailer';
import { getAdminClient } from '../../../lib/supabaseAdmin';
import { decrypt } from '../../../lib/integrations/crypto';
import { logCommunication } from '../../../lib/logCommunication';

// Resend is preferred when an owner has saved an API key in Settings →
// Integrations; falls back to the existing SMTP env vars otherwise, so
// nothing breaks for anyone who hasn't set up Resend yet.
async function getResendKey() {
  const admin = getAdminClient();
  const { data } = await admin.from('integration_credentials').select('api_key_enc, config').eq('provider', 'resend').single();
  if (!data) return null;
  return { apiKey: decrypt(data.api_key_enc), fromAddress: data.config?.from_address };
}

async function sendViaResend({ apiKey, fromAddress }, { to, subject, html, text, attachmentBase64, attachmentFilename }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress || 'McLoud Construction <info@mcloudconstruction.com>',
      to,
      subject,
      html,
      text,
      attachments: attachmentBase64 ? [{ filename: attachmentFilename || 'document.pdf', content: attachmentBase64 }] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}

async function sendViaSmtp({ to, subject, html, text, attachmentBase64, attachmentFilename }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Neither Resend nor SMTP is configured — add a Resend API key in Settings → Integrations, or set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in Vercel.');
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  const attachments = attachmentBase64
    ? [{ filename: attachmentFilename || 'document.pdf', content: attachmentBase64, encoding: 'base64' }]
    : undefined;
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html, attachments });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
    const { to, subject, category, jobId, sentBy } = body;
    const logMeta = { category: category || 'general', toEmail: to, subject: subject || null, jobId: jobId || null, sentBy: sentBy || null };

    if (!to || !to.trim()) {
      await logCommunication({ ...logMeta, toEmail: to || '(none)', status: 'failed', errorMessage: 'No recipient email is on file.' });
      return Response.json({ error: 'No recipient email is on file for this job yet.' }, { status: 400 });
    }

    const resend = await getResendKey();
    const provider = resend ? 'resend' : 'smtp';
    if (resend) {
      await sendViaResend(resend, body);
    } else {
      await sendViaSmtp(body);
    }

    await logCommunication({ ...logMeta, status: 'sent', provider });
    return Response.json({ success: true });
  } catch (err) {
    const { to, subject, category, jobId, sentBy } = body || {};
    await logCommunication({ category: category || 'general', toEmail: to || '(none)', subject: subject || null, jobId: jobId || null, sentBy: sentBy || null, status: 'failed', errorMessage: err.message });
    return Response.json({ error: err.message || 'Failed to send email.' }, { status: 500 });
  }
}
