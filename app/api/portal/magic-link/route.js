import { createClient } from '@supabase/supabase-js';
import { buildPortalInviteEmail } from '../../../../lib/emailTemplates';
import { logCommunication } from '../../../../lib/logCommunication';
import { sendMail } from '../../../../lib/sendMail';

// Self-service "Email me a link" — the customer/sub-facing counterpart to
// /api/portal/send-invite (which is staff-triggered and requires an admin
// session). Both existed as a symptom of the same bug: this button, on
// the Customer Portal, Sub Portal, and legacy /portal login pages, called
// supabase.auth.signInWithOtp() directly, which sends through Supabase
// Auth's own built-in mailer — separate infrastructure from Resend/SMTP,
// heavily rate-limited, and known to silently drop sends without
// returning an error (see the comment in send-invite/route.js for the
// original diagnosis). That's the "says it worked, email never arrives"
// symptom, and since it's a different code path entirely from
// sendMail()/logCommunication(), those failures never show up in
// Communications Log either — there's nothing here to log.
//
// This route generates the same kind of link server-side via
// admin.generateLink() and sends it the same way every other email in
// the app goes out, so it both actually delivers and gets logged.
//
// Deliberately unauthenticated (unlike send-invite) — this is the
// person requesting their own sign-in link, the same trust model
// signInWithOtp itself already had. No caller identity to check, and the
// response is the same whether or not the email has an account (matches
// generateLink's own default of auto-creating the auth user, same as
// signInWithOtp), so this can't be used to test which emails are valid.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const PORTAL_CONFIG = {
  customer: { redirectPath: '/customerportal/projects', portalLabel: 'project portal' },
  sub: { redirectPath: '/sub-portal/dashboard', portalLabel: 'subcontractor portal' },
};

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }

    const { email, portalType } = await request.json();
    const config = PORTAL_CONFIG[portalType];
    if (!email || !config) {
      return Response.json({ error: 'Missing or invalid fields.' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const redirectTo = `${siteUrl}${config.redirectPath}`;

    const service = serviceClient();
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (linkError) {
      return Response.json({ error: linkError.message }, { status: 500 });
    }

    const { subject, html, text } = buildPortalInviteEmail({ actionLink: linkData.properties.action_link, portalLabel: config.portalLabel });

    try {
      const { provider } = await sendMail({ to: email, subject, html, text });
      await logCommunication({ category: 'portal_magic_link', toEmail: email, subject, status: 'sent', provider });
    } catch (sendErr) {
      await logCommunication({ category: 'portal_magic_link', toEmail: email, subject, status: 'failed', errorMessage: sendErr.message, provider: 'unknown' });
      throw sendErr;
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send sign-in link.' }, { status: 500 });
  }
}
