import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { listGoogleJobTaggedMessages } from './gmailMessages';
import { listMicrosoftJobTaggedMessages } from './outlookMessages';
import { extractJobNumberFromSubject, threadKeyFor } from '../emailThreading';
import { syncCrmEmail } from './crmEmailSync';

const LISTERS = { google: listGoogleJobTaggedMessages, microsoft: listMicrosoftJobTaggedMessages };
// A connection made before mail scopes existed won't have re-consented
// yet — checked against the actual granted scope (stored at connect
// time), not just assumed, so this skips cleanly instead of failing loud
// API calls against a token that was never granted mail access.
const HAS_MAIL_SCOPE = {
  google: scope => (scope || '').includes('gmail.readonly'),
  microsoft: scope => (scope || '').includes('Mail.Read'),
};

// Pulls inbox mail whose subject carries our [Project #...] tag (or the
// older [Job #...] one it replaced) and files it
// onto that job's thread. Filtered to job-tagged mail only by the
// provider query itself — this deliberately never becomes a general
// inbox sync.
async function syncJobTaggedEmail(connection) {
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

    const { data: job } = await admin.from('jobs').select('id').eq('project_number', jobNumber).maybeSingle();
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
        thread_key: threadKeyFor(job.id, msg.subject),
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

// Entry point used by the daily automations cron and /api/cron/sync-email.
// Runs the original job tag sync, then the CRM email log (which does nothing
// unless an owner turned it on for this account in Settings). The two are
// independent: a failure in one never blocks the other. The CRM pass gets a
// shorter time budget here because the daily automations route has other
// work to finish inside its own time limit.
export async function syncConnectionEmail(connection) {
  const out = { synced: 0 };
  try {
    Object.assign(out, await syncJobTaggedEmail(connection));
  } catch (err) {
    out.error = err.message;
  }
  try {
    out.crm = await syncCrmEmail(connection, { budgetMs: 20000 });
  } catch (err) {
    out.crmError = err.message;
  }
  // Both passes have run by now. Surface any failure so the calling cron
  // still records it, exactly as it did before the CRM pass existed.
  if (out.error || out.crmError) {
    throw new Error([out.error, out.crmError && `CRM email log: ${out.crmError}`].filter(Boolean).join(' | '));
  }
  return out;
}
