// Consultation slots for the website chat assistant.
//
// Everything here is plain functions so it can be tested without a database.
// `loadAvailability` is the only part that reads Supabase.
//
// Rules, all set in Settings > Consultations:
//   weekly hours   which windows each weekday is open
//   slot_minutes   how long a consultation is
//   buffer_minutes travel and wrap up time kept around every consultation
//   min_notice     nothing sooner than this many hours from now
//   max_days_ahead how far out slots are offered
//   max_per_day    most consultations on one day
//   blackouts      dates, or a time range on dates, that are never offered
//
// A slot is also blocked when it overlaps (buffer included) a consultation
// already booked, a bid walk already scheduled on a lead, or a timed event on
// the calendar. All times are worked out in the business timezone
// (app_settings.timezone, America/Chicago by default), so daylight saving
// changes never shift a slot.

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DEFAULT_TZ = 'America/Chicago';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── Timezone helpers ────────────────────────────────────────────────────

function offsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// "2026-12-02" + "10:00" in a timezone -> the real instant.
export function zonedToUtc(dateStr, timeStr, tz = DEFAULT_TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = naive - offsetMs(new Date(naive), tz);
  // Second pass settles times near a daylight saving change.
  guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

// An instant -> its calendar date, clock time and weekday in a timezone.
export function localParts(date, tz = DEFAULT_TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday,
  };
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function dayKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isTimeString(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// "Tue, Dec 2 at 10:00 AM"
export function slotLabel(date, tz = DEFAULT_TZ) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} at ${time}`;
}

// ── Slot computation ────────────────────────────────────────────────────

function normalizeWindows(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(w => w && isTimeString(w.start) && isTimeString(w.end) && w.end > w.start)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * @param {object} args
 * @param {object} args.settings   consult_settings row
 * @param {Array}  args.blackouts  consult_blackouts rows
 * @param {Array}  args.busy       [{ start: Date, end: Date, counts: boolean }]
 * @param {Date}   args.now
 * @param {string} args.tz
 * @param {string} [args.fromDate] first day to consider (YYYY-MM-DD, business timezone)
 * @returns {Array<{ start: string, end: string, date: string, time: string, label: string }>}
 */
export function computeSlots({ settings, blackouts = [], busy = [], now = new Date(), tz = DEFAULT_TZ, fromDate }) {
  const slotMs = settings.slot_minutes * MIN;
  const bufferMs = settings.buffer_minutes * MIN;
  const stepMs = slotMs + bufferMs;
  const earliest = now.getTime() + settings.min_notice_hours * HOUR;

  const today = localParts(now, tz).date;
  const startDate = fromDate && isDateString(fromDate) && fromDate > today ? fromDate : today;
  const lastDate = addDays(today, settings.max_days_ahead);

  const slots = [];
  for (let date = startDate; date <= lastDate; date = addDays(date, 1)) {
    const windows = normalizeWindows(settings.weekly_hours?.[dayKey(date)]);
    if (!windows.length) continue;

    // Blackouts touching this date.
    const todays = blackouts.filter(b => b.start_date <= date && date <= b.end_date);
    if (todays.some(b => !b.start_time && !b.end_time)) continue; // whole day off
    const blockedRanges = todays
      .filter(b => b.start_time && b.end_time)
      .map(b => [
        zonedToUtc(date, String(b.start_time).slice(0, 5), tz).getTime(),
        zonedToUtc(date, String(b.end_time).slice(0, 5), tz).getTime(),
      ]);

    // Consultations and bid walks already on this day count toward the cap.
    const dayBusyCount = busy.filter(b => b.counts && localParts(b.start, tz).date === date).length;
    if (dayBusyCount >= settings.max_per_day) continue;

    for (const w of windows) {
      const windowEnd = zonedToUtc(date, w.end, tz).getTime();
      for (let t = zonedToUtc(date, w.start, tz).getTime(); t + slotMs <= windowEnd; t += stepMs) {
        const end = t + slotMs;
        if (t < earliest) continue;
        if (blockedRanges.some(([bs, be]) => overlaps(t, end, bs, be))) continue;
        // Keep the buffer around anything already on the calendar.
        const clash = busy.some(b => t < b.end.getTime() + bufferMs && end + bufferMs > b.start.getTime());
        if (clash) continue;
        const start = new Date(t);
        const parts = localParts(start, tz);
        slots.push({
          start: start.toISOString(),
          end: new Date(end).toISOString(),
          date: parts.date,
          time: parts.time,
          label: slotLabel(start, tz),
        });
      }
    }
  }
  return slots;
}

// ── Loading from the database ───────────────────────────────────────────

export async function loadAvailability(admin, { fromDate, now = new Date() } = {}) {
  const [{ data: settings }, { data: appSettings }] = await Promise.all([
    admin.from('consult_settings').select('*').eq('id', 1).maybeSingle(),
    admin.from('app_settings').select('timezone').eq('id', 1).maybeSingle(),
  ]);
  const tz = appSettings?.timezone || DEFAULT_TZ;
  if (!settings) return { settings: null, tz, slots: [], blackouts: [], busy: [] };

  const today = localParts(now, tz).date;
  const rangeStartDate = addDays(today, -1);
  const rangeEndDate = addDays(today, settings.max_days_ahead + 2);
  const rangeStart = zonedToUtc(rangeStartDate, '00:00', tz).toISOString();
  const rangeEnd = zonedToUtc(rangeEndDate, '00:00', tz).toISOString();

  const [blackoutRes, bookingRes, walkRes, eventRes] = await Promise.all([
    admin.from('consult_blackouts').select('*').gte('end_date', rangeStartDate),
    admin.from('consult_bookings').select('starts_at, ends_at').eq('status', 'booked').gte('starts_at', rangeStart).lt('starts_at', rangeEnd),
    admin.from('opportunities').select('bid_walk_scheduled_at').not('bid_walk_scheduled_at', 'is', null).gte('bid_walk_scheduled_at', rangeStart).lt('bid_walk_scheduled_at', rangeEnd),
    admin.from('schedule_events').select('event_date, event_time').not('event_time', 'is', null).gte('event_date', rangeStartDate).lt('event_date', rangeEndDate),
  ]);

  const slotMs = settings.slot_minutes * MIN;
  const busy = [];
  const seenStarts = new Set();

  for (const b of bookingRes.data || []) {
    const start = new Date(b.starts_at);
    seenStarts.add(start.getTime());
    busy.push({ start, end: new Date(b.ends_at), counts: true });
  }
  // A booked consultation also sets the lead's bid walk time. Count it once.
  for (const o of walkRes.data || []) {
    const start = new Date(o.bid_walk_scheduled_at);
    if (seenStarts.has(start.getTime())) continue;
    seenStarts.add(start.getTime());
    busy.push({ start, end: new Date(start.getTime() + slotMs), counts: true });
  }
  for (const e of eventRes.data || []) {
    const start = zonedToUtc(e.event_date, String(e.event_time).slice(0, 5), tz);
    busy.push({ start, end: new Date(start.getTime() + slotMs), counts: false });
  }

  const slots = computeSlots({ settings, blackouts: blackoutRes.data || [], busy, now, tz, fromDate });
  return { settings, tz, slots, blackouts: blackoutRes.data || [], busy };
}

// Spread a long list of slots across the next few days for the chat to offer.
export function pickOffer(slots, { days = 5, perDay = 4 } = {}) {
  const byDay = new Map();
  for (const s of slots) {
    if (!byDay.has(s.date)) byDay.set(s.date, []);
    byDay.get(s.date).push(s);
  }
  return [...byDay.entries()].slice(0, days).map(([date, list]) => ({ date, slots: list.slice(0, perDay) }));
}
