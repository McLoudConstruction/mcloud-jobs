import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { buildPortalActivationEmail } from '../../../../lib/emailTemplates';
import { sendMail } from '../../../../lib/sendMail';
import { logCommunication } from '../../../../lib/logCommunication';

// Issues a real activation invite — a single-use, expiring token that
// lands the customer on a "create your account" page, rather than the
// old plain magic-link sign-in. Idempotent and safe to call opportunistically
// (e.g. whenever a document is sent to someone who isn't activated yet):
// if the email already has an activated account, this is a no-op — it
// never re-sends an activation email to someone who's already set up.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function callerClient(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }

    const { accessToken, email, customerName, jobId } = await request.json();
    if (!accessToken || !email) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Only staff can trigger an invite — never trusted from an
    // unauthenticated caller.
    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }
    if (caller.app_metadata?.role !== 'admin') {
      return Response.json({ error: 'Only staff can send portal invites.' }, { status: 403 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return Response.json({ error: 'No email provided.' }, { status: 400 });
    }

    const service = serviceClient();

    const { data: existing } = await service.from('portal_accounts').select('*').eq('email', normalizedEmail).maybeSingle();
    if (existing?.activated_at) {
      // Already has an active account — nothing to invite, and definitely
      // nothing to re-email. The caller (e.g. a document-send flow) just
      // wanted to make sure this person was set up, and they already are.
      return Response.json({ success: true, alreadyActivated: true });
    }

    const inviteToken = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const now = new Date().toISOString();

    const { error: upsertError } = await service.from('portal_accounts').upsert({
      email: normalizedEmail,
      invite_token: inviteToken,
      invite_token_expires_at: expiresAt,
      invited_at: now,
      ...(existing ? {} : { created_at: now }),
    }, { onConflict: 'email' });
    if (upsertError) {
      return Response.json({ error: upsertError.message }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
    const actionLink = `${siteUrl}/customerportal/activate?token=${inviteToken}`;
    const { subject, html, text } = buildPortalActivationEmail({ customerName, actionLink });

    try {
      const { provider } = await sendMail({ to: email, subject, html, text });
      await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: caller.email, status: 'sent', provider });
    } catch (sendErr) {
      await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: caller.email, status: 'failed', errorMessage: sendErr.message });
      return Response.json({ error: sendErr.message || 'Failed to send invite email.' }, { status: 500 });
    }

    return Response.json({ success: true, resent: !!existing });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send invite.' }, { status: 500 });
  }
}
