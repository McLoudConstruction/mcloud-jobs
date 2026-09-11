import nodemailer from 'nodemailer';
import { getAdminClient } from './supabaseAdmin';
import { decrypt } from './integrations/crypto';

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

// Single entry point for actually dispatching an email — picks Resend or
// SMTP the same way every time, and reports back which one it used so
// callers can log it. Throws on failure; callers decide how to log/report.
export async function sendMail(payload) {
  const resend = await getResendKey();
  const provider = resend ? 'resend' : 'smtp';
  if (resend) {
    await sendViaResend(resend, payload);
  } else {
    await sendViaSmtp(payload);
  }
  return { provider };
}
