// Business-day (Mon-Fri) date math shared between the schedule generator
// API route and the editable phase list UI, so duration <-> date
// conversions can never drift between server-generated and
// client-recalculated schedules.

// Advances `duration` business days from startDate (YYYY-MM-DD).
// duration=1 means the phase occupies just the start day itself.
export function addBusinessDays(startDate, duration) {
  const d = new Date(startDate + 'T00:00:00');
  let remaining = Math.max(1, Math.round(duration)) - 1;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// The next business day after dateStr — used to place the next phase's
// start right after the previous phase's end.
export function nextBusinessDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The next Monday on or after dateStr — returns dateStr unchanged if it's
// already a Monday. Calendar-day walk, not business-day: Monday is
// always a business day, so there's nothing to skip.
export function nextMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Recomputes start_date/end_date for a full ordered phase list from a
// given start date, preserving each phase's duration_days. Used whenever
// a phase's duration is edited and everything downstream needs to shift.
// A phase with prefer_monday_start snaps its start forward to the next
// Monday before its duration is applied — e.g. punch list walks, which
// shouldn't kick off mid-week even if the previous phase wrapped on a
// Wednesday. Everything after it then continues from wherever that
// phase's (possibly pushed-out) end date lands.
export function recomputeSequentialDates(phases, startDate) {
  let cursor = startDate;
  return phases.map(p => {
    const start = p.prefer_monday_start ? nextMonday(cursor) : cursor;
    const end = addBusinessDays(start, p.duration_days);
    cursor = nextBusinessDay(end);
    return { ...p, start_date: start, end_date: end };
  });
}
