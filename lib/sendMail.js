import nodemailer from 'nodemailer';
import { getAdminClient } from './supabaseAdmin';
import { decrypt } from './integrations/crypto';
import { tagSubjectWithJob } from './emailThreading';

// Same defaults the old hardcoded LOGO_PUBLIC_URL/BRAND_BROWN constants in
// emailTemplates.js used to carry — used only if Settings → Branding has
// never been set, so a brand-new install still sends a branded-looking
// email instead of one with blank/broken tokens.
const DEFAULT_LOGO_URL = 'https://jobs.mcloudconstruction.com/mcloud-logo.png';
const DEFAULT_BRAND_COLOR = '#7d5a2e';

// Every email template emits {{LOGO_URL}}/{{BRAND_COLOR}} placeholders
// instead of a baked-in logo/color (see emailTemplates.js) — this is the
// one place, right before an email actually goes out, that fills them in
// from whatever's live in Settings → Branding, so every email reflects
// the current uploaded logo and brand color without every call site
// having to know how to fetch settings itself.
async function getEmailBranding() {
  const admin = getAdminClient();
  const { data } = await admin.from('app_settings').select('logo_url, brand_color').eq('id', 1).maybeSingle();
  return {
    logoUrl: data?.logo_url || DEFAULT_LOGO_URL,
    brandColor: data?.brand_color || DEFAULT_BRAND_COLOR,
  };
}

// Resend is preferred when an owner has saved an API key in Settings →
// Integrations; falls back to the existing SMTP env vars otherwise, so
// nothing breaks for anyone who hasn't set up Resend yet.
async function getResendKey() {
  const admin = getAdminClient();
  const { data } = await admin.from('integration_credentials').select('api_key_enc, config').eq('provider', 'resend').single();
  if (!data) return null;
  return { apiKey: decrypt(data.api_key_enc), fromAddress: data.config?.from_address };
}

async function sendViaResend({ apiKey, fromAddress }, { to, subject, html, text, attachmentBase64, attachmentFilename, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress || 'McLoud Construction <info@mcloudconstruction.com>',
      to,
      subject,
      html,
      text,
      // Resend requires the "from" address's domain to be verified for
      // sending (see technical-learnings on the send.* subdomain setup),
      // so a staff member's own inbox address can't just be dropped into
      // "from" without that verification. Reply-To doesn't have that
      // restriction and points a customer's reply straight at the staff
      // member who actually sent the message, which is the part that
      // actually matters to them.
      reply_to: replyTo || undefined,
      attachments: attachmentBase64 ? [{ filename: attachmentFilename || 'document.pdf', content: attachmentBase64 }] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}

async function sendViaSmtp({ to, subject, html, text, attachmentBase64, attachmentFilename, replyTo }) {
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
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html, attachments, replyTo: replyTo || undefined });
}

// Single entry point for actually dispatching an email — picks Resend or
// SMTP the same way every time, and reports back which one it used so
// callers can log it. Throws on failure; callers decide how to log/report.
//
// Every send that carries a jobId gets the job number tagged onto its
// subject line ([Job #2026-003]) — this is what lets a reply get filed
// back onto the right job's thread later, and it's applied here, once,
// so no caller has to remember to do it themselves.
export async function sendMail(payload) {
  let subject = payload.subject;
  if (payload.jobId) {
    const admin = getAdminClient();
    const { data: job } = await admin.from('jobs').select('job_number').eq('id', payload.jobId).maybeSingle();
    if (job?.job_number) subject = tagSubjectWithJob(subject, job.job_number);
  }
  let html = payload.html;
  if (html && (html.includes('{{LOGO_URL}}') || html.includes('{{BRAND_COLOR}}'))) {
    const { logoUrl, brandColor } = await getEmailBranding();
    html = html.split('{{LOGO_URL}}').join(logoUrl).split('{{BRAND_COLOR}}').join(brandColor);
  }
  // Whoever actually triggered this send (staff member logged in at the
  // time) gets set as Reply-To, so a customer's reply lands in that
  // person's real inbox instead of bouncing off the generic sending
  // address. Every call site already threads a `sentBy` staff email
  // through for the Communications Log — this reuses it rather than
  // requiring a second field. An explicit `replyTo` on the payload wins
  // if a caller ever needs to override it.
  const replyTo = payload.replyTo || payload.sentBy || undefined;
  const taggedPayload = { ...payload, subject, html, replyTo };

  const resend = await getResendKey();
  const provider = resend ? 'resend' : 'smtp';
  if (resend) {
    await sendViaResend(resend, taggedPayload);
  } else {
    await sendViaSmtp(taggedPayload);
  }
  return { provider, subject };
}
