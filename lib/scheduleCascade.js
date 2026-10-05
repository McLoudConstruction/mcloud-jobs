// Pure logic for "this phase moved, which of the phases after it move too?"
// No database access: callers pass rows in and get the changed rows back.
//
// The rule the whole feature rests on: delaying a phase never silently
// moves anything. The caller shows the candidates from followerCandidates()
// as a checklist, and only the ids the user leaves ticked are passed to
// applyCascade(). Linked phases (job_phases.depends_on) are ticked by
// default, everything else starts unticked.

import { countWorkableDays } from './scheduleDates';

const toDate = s => new Date(s + 'T00:00:00');
const iso = d => d.toISOString().slice(0, 10);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

// Moves a date by n working days (negative moves earlier). Phases that
// allow weekend work count every calendar day.
export function addWorkdaysSigned(dateStr, n, allowWeekends = false) {
  const d = toDate(dateStr);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    d.setDate(d.getDate() + step);
    if (allowWeekends || !isWeekend(d)) left--;
  }
  return iso(d);
}

// Signed count of working days from a to b (b later than a is positive).
export function workdaysBetween(a, b, allowWeekends = false) {
  if (a === b) return 0;
  const forward = b > a;
  const d = toDate(forward ? a : b);
  const stop = toDate(forward ? b : a);
  let n = 0;
  while (d < stop) {
    d.setDate(d.getDate() + 1);
    if (allowWeekends || !isWeekend(d)) n++;
  }
  return forward ? n : -n;
}

// Everything that waits on phaseId, directly or through a chain of links.
export function linkedDependents(phases, phaseId) {
  const out = new Set();
  let frontier = [phaseId];
  while (frontier.length) {
    const next = [];
    for (const p of phases) {
      if (p.depends_on && frontier.includes(p.depends_on) && !out.has(p.id) && p.id !== phaseId) {
        out.add(p.id);
        next.push(p.id);
      }
    }
    frontier = next;
  }
  return out;
}

// The phases worth offering when `anchor` moves: anything that hasn't
// finished and starts on or after the anchor's original start (so earlier
// work and the anchor itself are never listed). `checked` is the default
// tick state: linked dependents when the anchor has any, otherwise every
// phase that starts after the anchor finishes (plain sequential schedule).
export function followerCandidates(phases, anchor, today) {
  const dependents = linkedDependents(phases, anchor.id);
  const later = phases
    .filter(p => p.id !== anchor.id && p.status !== 'draft')
    .filter(p => (!today || p.end_date >= today))
    .filter(p => p.start_date >= anchor.start_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return later.map(p => ({
    phase: p,
    linked: dependents.has(p.id),
    checked: dependents.size > 0 ? dependents.has(p.id) : p.start_date > anchor.end_date,
  }));
}

// Shifts the chosen phases by `workdays` (each by its own weekend rule,
// keeping its own length). Returns only the rows that changed.
export function applyCascade(phases, selectedIds, workdays) {
  if (!workdays) return [];
  const chosen = new Set(selectedIds);
  return phases.filter(p => chosen.has(p.id)).map(p => {
    const allow = !!p.allow_weekend_work;
    const start = addWorkdaysSigned(p.start_date, workdays, allow);
    const end = addWorkdaysSigned(p.end_date, workdays, allow);
    return { ...p, start_date: start, end_date: end, duration_days: countWorkableDays(start, end, allow) };
  });
}

// What a delay of `workdays` does to the phase that is slipping: not yet
// started, it moves whole; already underway, its end moves and it keeps its
// start (the work still has to finish, it just finishes later).
export function delayAnchor(phase, workdays, today) {
  const allow = !!phase.allow_weekend_work;
  if (phase.start_date > today) {
    const start = addWorkdaysSigned(phase.start_date, workdays, allow);
    const end = addWorkdaysSigned(phase.end_date, workdays, allow);
    return { ...phase, start_date: start, end_date: end, duration_days: countWorkableDays(start, end, allow) };
  }
  const end = addWorkdaysSigned(phase.end_date, workdays, allow);
  return { ...phase, end_date: end, duration_days: countWorkableDays(phase.start_date, end, allow) };
}

// Working-day change in a phase's finish, which is what its followers
// should be shifted by when the phase is dragged or lengthened.
export function finishDelta(before, after) {
  return workdaysBetween(before.end_date, after.end_date, !!before.allow_weekend_work);
}

// Writes link rows for a freshly published schedule: each phase waits on
// the previous one, only where it truly follows on (previous ends before
// this one starts). Concurrent phases stay unlinked. No-op when links exist.
export async function linkSequentialPhases(supabase, jobId) {
  const { data } = await supabase.from('job_phases').select('id, start_date, end_date, sort_order, depends_on').eq('job_id', jobId).eq('status', 'published').order('sort_order').order('start_date');
  if (!data || data.some(p => p.depends_on)) return;
  const updates = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].end_date < data[i].start_date) updates.push(supabase.from('job_phases').update({ depends_on: data[i - 1].id }).eq('id', data[i].id));
  }
  await Promise.all(updates);
}
