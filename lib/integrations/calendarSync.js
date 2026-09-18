import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { upsertGoogleJobEvent, upsertGoogleTimedEvent, listGoogleBusyEvents } from './googleCalendar';
import { upsertMicrosoftJobEvent, upsertMicrosoftTimedEvent, listMicrosoftBusyEvents } from './microsoftCalendar';
import { EVENT_TYPE_LABELS } from '../constants';

const PUSHERS = { google: upsertGoogleJobEvent, microsoft: upsertMicrosoftJobEvent };
const TIMED_PUSHERS = { google: upsertGoogleTimedEvent, microsoft: upsertMicrosoftTimedEvent };
const PULLERS = { google: listGoogleBusyEvents, microsoft: listMicrosoftBusyEvents };

// The business's own timezone — schedule_events.event_date/event_time are
// naive wall-clock values entered through a browser date/time picker (no
// timezone attached), meant as this local time. This server runs on
// Vercel, whose functions run in UTC, so `new Date('2026-09-17T15:15:00')`
// here parses as 15:15 UTC, not 15:15 Central — a straight "3:15pm shows
// up as 10:15am" 5-hour bug. Job/bid-walk pushes don't need this: their
// source columns (scheduled_start_date is date-only/all-day; bid_walk_
// scheduled_at is already a real timestamptz written from the BROWSER's
// own local time via `new Date(value).toISOString()`) never go through a
// naive server-side parse in the first place.
const BUSINESS_TIMEZONE = 'America/Chicago';

// Converts a naive local wall-clock date+time in `timeZone` to the correct
// UTC Date, without a timezone library — Intl.DateTimeFormat is enough.
// One pass: treat the wall-clock as if it were UTC, ask what that instant
// actually reads as in `timeZone`, and correct by the difference. DST
// transitions are rare enough (and this is a single business's own
// calendar, not a scheduling system spanning them) that one pass is
// plenty — no iteration needed.
function zonedTimeToUTC(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute, second = 0] = timeStr.split(':').map(Number);
  const asIfUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(asIfUTC).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const readsAs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  return new Date(asIfUTC.getTime() - (readsAs - asIfUTC.getTime()));
}

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

  // --- push manually-created schedule events (Calendar page "New Event")
  // --- distinct from both loops above: not tied to a job's own schedule
  // dates or a lead's bid-walk time, so nothing pushed them until now (see
  // migration 110's note — this table existed for a while with nothing
  // reading it for sync). Timed if an event_time was given, otherwise a
  // single all-day block.
  let pushedScheduleEvents = 0;
  if (timedPusher) {
    const { data: scheduleEvents } = await admin
      .from('schedule_events')
      .select('id, event_type, description, event_date, event_time')
      .gte('event_date', cutoff.toISOString().slice(0, 10));

    const { data: existingEventLinks } = await admin
      .from('calendar_sync_events')
      .select('id, schedule_event_id, external_event_id')
      .eq('connection_id', connection.id)
      .not('schedule_event_id', 'is', null);
    const linkByEvent = Object.fromEntries((existingEventLinks || []).map(l => [l.schedule_event_id, l]));

    for (const ev of scheduleEvents || []) {
      const link = linkByEvent[ev.id];
      const title = ev.description || EVENT_TYPE_LABELS[ev.event_type] || 'Scheduled event';
      try {
        let event;
        if (ev.event_time) {
          const start = zonedTimeToUTC(ev.event_date, ev.event_time, BUSINESS_TIMEZONE);
          const end = new Date(start.getTime() + 60 * 60 * 1000); // 1hr block, same as bid walks
          event = await timedPusher(accessToken, link?.external_event_id, {
            title, description: 'McLoud Jobs — scheduled event', startISO: start.toISOString(), endISO: end.toISOString(),
          });
        } else {
          event = await pusher(accessToken, link?.external_event_id, {
            title, description: 'McLoud Jobs — scheduled event', startDate: ev.event_date, endDate: ev.event_date,
          });
        }
        if (link) {
          await admin.from('calendar_sync_events').update({ last_pushed_at: new Date().toISOString() }).eq('id', link.id);
        } else {
          await admin.from('calendar_sync_events').insert({ connection_id: connection.id, schedule_event_id: ev.id, external_event_id: event.id });
        }
        pushedScheduleEvents++;
      } catch (err) {
        console.error(`Calendar push failed for schedule event ${ev.id} (${connection.provider}):`, err.message);
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

  return { pushed, pushedBidWalks, pushedScheduleEvents, pulled };
}
