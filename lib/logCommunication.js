import { getAdminClient } from './supabaseAdmin';

// Single funnel for writing to communications_log, called from every
// server route that sends an email (the shared /api/send-email endpoint,
// staff invites, portal invites, the daily-automations cron). Logging is
// best-effort and must never be the reason a real send fails or a caller
// sees an error it didn't cause — every failure here is swallowed and only
// printed to the server console.
export async function logCommunication({
  channel = 'email',
  category = 'general',
  toEmail,
  subject = null,
  jobId = null,
  sentBy = null,
  status = 'sent',
  errorMessage = null,
  provider = null,
}) {
  try {
    if (!toEmail) return;
    const admin = getAdminClient();
    const { error } = await admin.from('communications_log').insert({
      channel,
      category,
      to_email: toEmail,
      subject,
      job_id: jobId,
      sent_by: sentBy,
      status,
      error_message: errorMessage,
      provider,
    });
    if (error) console.error('logCommunication insert failed:', error.message);
  } catch (err) {
    console.error('logCommunication failed:', err.message);
  }
}
