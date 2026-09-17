import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { upsertGoogleJobEvent, upsertGoogleTimedEvent, listGoogleBusyEvents } from './googleCalendar';
import { upsertMicrosoftJobEvent, upsertMicrosoftTimedEvent, listMicrosoftBusyEvents } from './microsoftCalendar';

const PUSHERS = { google: upsertGoogleJobEvent, microsoft: upsertMicrosoftJobEvent };
const TIMED_PUSHERS = { google: upsertGoogleTimedEvent, microsoft: upsertMicrosoftTimedEvent };
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

  // --- push bid walks / inspections (leads scheduled but not yet
  // converted to a job) — a separate loop from job events above since
  // these link via opportunity_id, not job_id, and need a specific time
  // rather than an all-day block.
  const timedPusher = TIMED_PUSHERS[connection.provider];
  let pushedBidWalks = 0;
  if (timedPusher) {
    const { data: opportunities } = await admin
      .from('opportunities')
      .select('id, contact_name, project, bid_walk_scheduled_at')
      .not('bid_walk_scheduled_at', 'is', null)
      .gte('bid_walk_scheduled_at', cutoff.toISOString());

    const { data: existingOppLinks } = await admin
      .from('calendar_sync_events')
      .select('id, opportunity_id, external_event_id')
      .eq('connection_id', connection.id)
      .not('opportunity_id', 'is', null);
    const linkByOpp = Object.fromEntries((existingOppLinks || []).map(l => [l.opportunity_id, l]));

    for (const opp of opportunities || []) {
      const link = linkByOpp[opp.id];
      try {
        const start = new Date(opp.bid_walk_scheduled_at);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // 1hr block
        const event = await timedPusher(accessToken, link?.external_event_id, {
          title: `Bid walk — ${opp.contact_name || 'Lead'}${opp.project ? ` (${opp.project})` : ''}`,
          description: 'McLoud Jobs — scheduled bid walk / inspection',
          startISO: start.toISOString(),
          endISO: end.toISOString(),
        });
        if (link) {
          await admin.from('calendar_sync_events').update({ last_pushed_at: new Date().toISOString() }).eq('id', link.id);
        } else {
          await admin.from('calendar_sync_events').insert({ connection_id: connection.id, opportunity_id: opp.id, external_event_id: event.id });
        }
        pushedBidWalks++;
      } catch (err) {
        console.error(`Calendar push failed for bid walk ${opp.id} (${connection.provider}):`, err.message);
      }
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

  return { pushed, pushedBidWalks, pulled };
}
