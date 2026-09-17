import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { listGoogleJobTaggedMessages } from './gmailMessages';
import { listMicrosoftJobTaggedMessages } from './outlookMessages';
import { extractJobNumberFromSubject } from '../emailThreading';

const LISTERS = { google: listGoogleJobTaggedMessages, microsoft: listMicrosoftJobTaggedMessages };
// A connection made before mail scopes existed won't have re-consented
// yet — checked against the actual granted scope (stored at connect
// time), not just assumed, so this skips cleanly instead of failing loud
// API calls against a token that was never granted mail access.
const HAS_MAIL_SCOPE = {
  google: scope => (scope || '').includes('gmail.readonly'),
  microsoft: scope => (scope || '').includes('Mail.Read'),
};

// Pulls inbox mail whose subject carries our [Job #...] tag and files it
// onto that job's thread. Filtered to job-tagged mail only by the
// provider query itself — this deliberately never becomes a general
// inbox sync.
export async function syncConnectionEmail(connection) {
  const lister = LISTERS[connection.provider];
  if (!lister) return { synced: 0 }; // e.g. quickbooks — not a mail provider
  if (!HAS_MAIL_SCOPE[connection.provider]?.(connection.scope)) {
    return { synced: 0, skipped: 'Reconnect this account in Settings → Integrations to grant mail access.' };
  }

  const admin = getAdminClient();
  const accessToken = await getValidAccessToken(connection);
  const messages = await lister(accessToken, connection.email_last_synced_at);

  let synced = 0;
  for (const msg of messages) {
    const jobNumber = extractJobNumberFromSubject(msg.subject);
    if (!jobNumber) continue; // defensive — the provider query already filters to tagged subjects

    const { data: job } = await admin.from('jobs').select('id').eq('job_number', jobNumber).maybeSingle();
    if (!job) continue; // tagged with a job number that doesn't match anything real — skip rather than guess

    const { error } = await admin.from('email_messages').upsert(
      {
        job_id: job.id,
        connection_id: connection.id,
        direction: 'inbound',
        provider: connection.provider,
        provider_message_id: msg.providerMessageId,
        provider_thread_id: msg.providerThreadId,
        from_email: msg.fromEmail,
        to_email: msg.toEmail,
        subject: msg.subject,
        snippet: msg.snippet,
        body_text: msg.bodyText,
        body_html: msg.bodyHtml,
        received_at: msg.receivedAt,
      },
      { onConflict: 'connection_id,provider_message_id', ignoreDuplicates: true }
    );
    if (!error) synced++;
  }

  await admin.from('integration_connections').update({ email_last_synced_at: new Date().toISOString() }).eq('id', connection.id);
  return { synced };
}
