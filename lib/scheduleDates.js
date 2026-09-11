// Date math shared between the schedule generator API route and the
// editable phase list UI, so duration <-> date conversions can never
// drift between server-generated and client-recalculated schedules.
//
// Weekend allowance and start-day preference are both PER-PHASE
// properties now (job_phases.allow_weekend_work,
// job_phases.preferred_start_day) — a job commonly has some phases
// that are fine on a weekend and others that aren't, so there's no
// single job-wide flag to thread through here anymore. Every function
// below reads those settings off the phase object itself.

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// The literal next calendar day — no weekend skipping. Used to move the
// cursor past a phase's end date; whether the NEXT phase actually lands
// on that day or gets pushed forward is that next phase's own decision
// (see recomputeSequentialDates), not something decided here.
export function nextDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The next Monday-Friday day on or after dateStr.
export function nextWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The next occurrence of a named weekday ('monday', 'tuesday', ...) on
// or after dateStr. Returns dateStr unchanged if it's already invalid
// input (unrecognized day name) or already that day.
export function nextOccurrenceOfDay(dateStr, dayName) {
  const targetIdx = DAY_NAMES.indexOf((dayName || '').toLowerCase());
  if (targetIdx === -1) return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  while (d.getDay() !== targetIdx) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Advances `duration` days from startDate, skipping weekends unless
// allowWeekends is true. duration=1 means the phase occupies just the
// start day itself.
export function addDurationDays(startDate, duration, allowWeekends = false) {
  const d = new Date(startDate + 'T00:00:00');
  let remaining = Math.max(1, Math.round(duration)) - 1;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (allowWeekends) { remaining--; continue; }
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// Recomputes start_date/end_date for a full ordered phase list from a
// given start date, preserving each phase's duration_days. Used
// whenever a phase's duration is edited and everything downstream needs
// to shift.
//
// For each phase, in order:
//   1. The cursor lands on the literal next day after the previous
//      phase ended (no skipping yet).
//   2. If this phase has a preferred_start_day, the start snaps forward
//      to the next occurrence of that day — this takes priority over
//      weekend-skipping, since an explicit day choice is more specific
//      than the default "just avoid weekends" behavior.
//   3. Otherwise, if this phase does NOT allow weekend work (the
//      default), the start snaps forward past any weekend.
//   4. The phase's own duration is then applied, itself skipping
//      weekends unless this phase allows weekend work.
export function recomputeSequentialDates(phases, startDate) {
  let cursor = startDate;
  return phases.map(p => {
    let start = cursor;
    if (p.preferred_start_day) {
      start = nextOccurrenceOfDay(start, p.preferred_start_day);
    } else if (!p.allow_weekend_work) {
      start = nextWeekday(start);
    }
    const end = addDurationDays(start, p.duration_days, p.allow_weekend_work);
    cursor = nextDay(end);
    return { ...p, start_date: start, end_date: end };
  });
}

// Counts how many days in [startDate, endDate] (inclusive) are actually
// workable — every day if allowWeekends, otherwise excluding Sat/Sun.
// Needed because a phase's date range can be set directly (dragged on
// the Timeline) rather than derived through recomputeSequentialDates —
// if that range happens to span a weekend on a phase that doesn't work
// weekends, duration_days still needs to reflect only the days actually
// worked, not the full calendar span.
export function countWorkableDays(startDate, endDate, allowWeekends = false) {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    if (allowWeekends || (cur.getDay() !== 0 && cur.getDay() !== 6)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

// Splits [startDate, endDate] into contiguous workable-day segments,
// breaking at any weekend, when allowWeekends is false. This is what
// lets a phase's bar render as two separate blocks with a visible gap
// over the weekend instead of one solid block — a solid bar spanning a
// weekend a customer isn't paying for would misleadingly suggest work
// happens then. Returns a single segment covering the whole range when
// allowWeekends is true or the range never actually touches a weekend.
export function splitAtWeekends(startDate, endDate, allowWeekends = false) {
  if (allowWeekends) return [{ start: startDate, end: endDate }];
  const segments = [];
  let segStart = null;
  let prev = null;
  const cur = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (cur <= end) {
    const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
    const iso = cur.toISOString().slice(0, 10);
    if (!isWeekend) {
      if (segStart === null) segStart = iso;
      prev = iso;
    } else if (segStart !== null) {
      segments.push({ start: segStart, end: prev });
      segStart = null;
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (segStart !== null) segments.push({ start: segStart, end: prev });
  return segments.length > 0 ? segments : [{ start: startDate, end: endDate }];
}
