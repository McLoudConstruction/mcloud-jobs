import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { buildPortalInviteEmail } from '../../../../lib/emailTemplates';

// Portal invites used to go through supabase.auth.signInWithOtp(), which
// sends via Supabase's own built-in Auth email service — completely
// separate infrastructure from the SMTP used by every other email in this
// app. That built-in mailer is explicitly not meant for production use:
// it's heavily rate-limited and can silently drop sends without ever
// returning an error, which is exactly the "says it succeeded, never
// arrives" symptom. This route generates the magic link server-side
// (admin-only operation) and sends it through the same working SMTP
// transporter as everything else instead.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function callerClient(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return Response.json({ error: 'SMTP is not configured yet — add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in Vercel.' }, { status: 500 });
    }

    const { accessToken, email, customerName, redirectTo } = await request.json();
    if (!accessToken || !email || !redirectTo) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Only an admin session can trigger this — never trusted from an
    // unauthenticated caller, since generateLink is a privileged op.
    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }
    if (caller.app_metadata?.role !== 'admin') {
      return Response.json({ error: 'Only staff can send portal invites.' }, { status: 403 });
    }

    const service = serviceClient();
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (linkError) {
      return Response.json({ error: linkError.message }, { status: 500 });
    }

    const { subject, html, text } = buildPortalInviteEmail({ customerName, actionLink: linkData.properties.action_link });

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject,
      html,
      text,
    });

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send invite.' }, { status: 500 });
  }
}
