import { createClient } from '@supabase/supabase-js';
import { buildPortalInviteEmail } from '../../../../lib/emailTemplates';
import { logCommunication } from '../../../../lib/logCommunication';
import { sendMail } from '../../../../lib/sendMail';

// Portal invites used to go through supabase.auth.signInWithOtp(), which
// sends via Supabase's own built-in Auth email service — completely
// separate infrastructure from what every other email in this app uses.
// That built-in mailer is explicitly not meant for production use: it's
// heavily rate-limited and can silently drop sends without ever
// returning an error, which is exactly the "says it succeeded, never
// arrives" symptom. This route generates the magic link server-side
// (admin-only operation) and sends it through sendMail() — Resend when
// configured, SMTP as a fallback — same as every other email in the app
// (see /api/send-email). This route used to hand-roll its own
// SMTP-only nodemailer send here, which meant it never picked up Resend
// at all and broke outright once SMTP env vars stopped being set.

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

    const { accessToken, email, customerName, redirectTo, jobId } = await request.json();
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

    // jobId isn't passed into sendMail() here (only into logCommunication
    // below) — this invite isn't scoped to one job, and tagging the
    // subject with a job number would be wrong/confusing for what's an
    // account-access email, not a job-thread email.
    try {
      const { provider } = await sendMail({ to: email, subject, html, text, sentBy: caller.email });
      await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: caller.email, status: 'sent', provider });
    } catch (sendErr) {
      await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: caller.email, status: 'failed', errorMessage: sendErr.message, provider: 'unknown' });
      throw sendErr;
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send invite.' }, { status: 500 });
  }
}
