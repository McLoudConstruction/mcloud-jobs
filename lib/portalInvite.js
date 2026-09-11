import { randomUUID } from 'crypto';
import { getAdminClient } from './supabaseAdmin';
import { buildPortalActivationEmail } from './emailTemplates';
import { sendMail } from './sendMail';
import { logCommunication } from './logCommunication';

// Issues a real activation invite — a single-use, expiring token that
// lands the customer on a "create your account" page, rather than the old
// plain magic-link sign-in. Idempotent and safe to call opportunistically
// (e.g. whenever a document is sent to someone who isn't activated yet, or
// across many contacts in a backfill): if the email already has an
// activated account, this is a no-op — it never re-sends an activation
// email to someone who's already set up.
//
// Shared by /api/portal/create-invite (one contact, staff-triggered from
// the UI) and /api/portal/backfill-invites (many contacts at once).
// Callers are responsible for their own admin-auth check before calling
// this — it does not verify who's asking.

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function issuePortalInvite({ email, customerName, jobId, sentByEmail }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return { success: false, error: 'No email provided.' };

  const service = getAdminClient();

  const { data: existing } = await service.from('portal_accounts').select('*').eq('email', normalizedEmail).maybeSingle();
  if (existing?.activated_at) {
    return { success: true, alreadyActivated: true };
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
  if (upsertError) return { success: false, error: upsertError.message };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
  const actionLink = `${siteUrl}/customerportal/activate?token=${inviteToken}`;
  const { subject, html, text } = buildPortalActivationEmail({ customerName, actionLink });

  try {
    const { provider } = await sendMail({ to: email, subject, html, text });
    await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: sentByEmail || null, status: 'sent', provider });
  } catch (sendErr) {
    await logCommunication({ category: 'portal_invite', toEmail: email, subject, jobId: jobId || null, sentBy: sentByEmail || null, status: 'failed', errorMessage: sendErr.message });
    return { success: false, error: sendErr.message || 'Failed to send invite email.' };
  }

  return { success: true, resent: !!existing };
}
