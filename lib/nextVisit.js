// What the customer portal's "Next Scheduled Visit" card should say.
//
// Rule:
//   - Before the project's scheduled start date: show the start date, and the
//     phase that kicks things off.
//   - On or after the start date: show whichever comes next, a published
//     schedule phase or an event staff shared with the customer. A phase that
//     is already underway counts as "today" (or the next working day if
//     today is a weekend the phase doesn't work).
//
// All dates here are plain 'YYYY-MM-DD' strings compared as strings (they sort
// correctly), never run through Date-with-timezone, so a customer's timezone
// can't shift a day. Pure functions, no imports, easy to test.

export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

function isWeekend(iso) {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return dow === 0 || dow === 6;
}

// The date a phase "counts" for: its start if it is still ahead, otherwise
// today, nudged to the next weekday when the phase doesn't work weekends.
// Null once the phase has no working day left.
function phaseDate(p, today) {
  if (!p.start_date || !p.end_date || p.end_date < today) return null;
  if (p.start_date >= today) return p.start_date;
  let d = today;
  if (!p.allow_weekend_work) {
    for (let i = 0; i < 3 && isWeekend(d); i++) d = addDays(d, 1);
  }
  return d <= p.end_date ? d : null;
}

// Names of the phases actually running on a date (weekends only count for
// phases that allow weekend work), in schedule order.
function phasesOn(phases, date) {
  return phases
    .filter(p => p.start_date && p.end_date && p.start_date <= date && date <= p.end_date && (!isWeekend(date) || p.allow_weekend_work))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(p => p.label);
}

// Returns null when there is nothing to show, otherwise:
//   { kind: 'start' | 'event' | 'phase', date, endDate, eventType, time, phaseLabels }
export function pickNextVisit({ today, startDate, endDate, phases = [], events = [] }) {
  const livePhases = phases.filter(p => p.start_date && p.end_date);

  if (startDate && today < startDate) {
    const first = livePhases.reduce((min, p) => (min === null || p.start_date < min ? p.start_date : min), null);
    const firstLabels = first
      ? livePhases.filter(p => p.start_date === first).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(p => p.label)
      : [];
    return { kind: 'start', date: startDate, endDate: endDate && endDate !== startDate ? endDate : null, eventType: null, time: null, phaseLabels: firstLabels };
  }

  const candidates = [];
  for (const e of events) {
    if (e.event_date && e.event_date >= today) {
      candidates.push({ kind: 'event', date: e.event_date, time: e.event_time || null, eventType: e.event_type });
    }
  }
  for (const p of livePhases) {
    const d = phaseDate(p, today);
    if (d) candidates.push({ kind: 'phase', date: d, time: null, eventType: null });
  }
  if (candidates.length === 0) return null;

  // Soonest date first; on the same day a shared event leads (it is a
  // specific visit), and timed events come before all-day ones.
  candidates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
    return (a.time || '99:99').localeCompare(b.time || '99:99');
  });
  const best = candidates[0];
  return { ...best, endDate: null, phaseLabels: phasesOn(livePhases, best.date) };
}
