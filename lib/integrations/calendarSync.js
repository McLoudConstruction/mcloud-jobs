import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { upsertGoogleJobEvent, listGoogleBusyEvents } from './googleCalendar';
import { upsertMicrosoftJobEvent, listMicrosoftBusyEvents } from './microsoftCalendar';

const PUSHERS = { google: upsertGoogleJobEvent, microsoft: upsertMicrosoftJobEvent };
const PULLERS = { google: listGoogleBusyEvents, microsoft: listMicrosoftBusyEvents };

// Push: any job with a scheduled_start_date in the last 30 days or the
// future gets created/updated as an all-day event on the connection's
// calendar. Older jobs are left alone — no point syncing history.
// Pull: events in the next 60 days from the connection's calendar are
// cached as "busy" blocks for the office to see.
export async function syncConnection(connection) {
  const admin = getAdminClient();
  const accessToken = await getValidAccessToken(connection);
  const pusher = PUSHERS[connection.provider];
  const puller = PULLERS[connection.provider];
  if (!pusher || !puller) return { pushed: 0, pulled: 0 }; // e.g. quickbooks — not a calendar provider

  // --- push job events ---
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const { data: jobs } = await admin
    .from('jobs')
    .select('id, job_number, customer_name, scheduled_start_date, scheduled_end_date')
    .not('scheduled_start_date', 'is', null)
    .gte('scheduled_start_date', cutoff.toISOString().slice(0, 10));

  const { data: existingLinks } = await admin
    .from('calendar_sync_events')
    .select('id, job_id, external_event_id')
    .eq('connection_id', connection.id);
  const linkByJob = Object.fromEntries((existingLinks || []).map(l => [l.job_id, l]));

  let pushed = 0;
  for (const job of jobs || []) {
    const link = linkByJob[job.id];
    try {
      const event = await pusher(accessToken, link?.external_event_id, {
        title: `Job #${job.job_number} — ${job.customer_name || 'Job'}`,
        description: `McLoud Jobs — job #${job.job_number}`,
        startDate: job.scheduled_start_date,
        endDate: job.scheduled_end_date,
      });
      if (link) {
        await admin.from('calendar_sync_events').update({ last_pushed_at: new Date().toISOString() }).eq('id', link.id);
      } else {
        await admin.from('calendar_sync_events').insert({ connection_id: connection.id, job_id: job.id, external_event_id: event.id });
      }
      pushed++;
    } catch (err) {
      console.error(`Calendar push failed for job ${job.id} (${connection.provider}):`, err.message);
    }
  }

  // --- pull busy events ---
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + 60);
  let pulled = 0;
  try {
    const events = await puller(accessToken, now.toISOString(), future.toISOString());
    // Replace this connection's cached window each run — simplest way to
    // drop events that were deleted or moved on the provider's side.
    await admin.from('external_busy_events').delete().eq('connection_id', connection.id);
    if (events.length) {
      await admin.from('external_busy_events').insert(events.map(e => ({
        connection_id: connection.id,
        external_event_id: e.externalEventId,
        title: e.title,
        start_at: e.startAt,
        end_at: e.endAt,
        last_synced_at: new Date().toISOString(),
      })));
    }
    pulled = events.length;
  } catch (err) {
    console.error(`Calendar pull failed (${connection.provider}):`, err.message);
  }

  return { pushed, pulled };
}
