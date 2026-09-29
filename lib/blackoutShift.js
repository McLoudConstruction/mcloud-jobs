import { calendarSpan, shiftCalendarDays, nextWeekday, nextOccurrenceOfDay, countWorkableDays, addDurationDays } from './scheduleDates';

// Pure planning step: given a job's published phases and a customer blackout
// window, work out which phases have to move and where.
//
// Rules (a blackout means nobody can be on site — the work pauses, then resumes):
//   • A phase that finishes before the blackout starts is untouched.
//   • A phase already under way when the blackout starts is paused — its end
//     date is pushed out by the length of the blackout.
//   • A phase that would START inside the blackout is pushed to the first
//     working day after it (respecting the phase's own weekend/preferred-day
//     rules) and keeps its working-day length; everything after it moves by
//     the same number of calendar days, then snaps to a working day.
//
// Dates are 'YYYY-MM-DD'. Returns the updates to write plus a summary.
export function planBlackoutShift(phases, blackoutStart, blackoutEnd) {
  const sorted = [...phases].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : (a.sort_order || 0) - (b.sort_order || 0)));
  const firstDayAfter = shiftCalendarDays(blackoutEnd, 1);
  const workable = p => !p.allow_weekend_work;
  // Calendar days everything after the point of impact has been pushed so
  // far; each later phase carries the same push so spacing is preserved.
  let delta = 0;
  let paused = false;
  const updates = [];
  const daysBetween = (a, b) => calendarSpan(a, b) - 1; // b - a, in calendar days

  for (const p of sorted) {
    const duration = p.duration_days || countWorkableDays(p.start_date, p.end_date, !workable(p));
    let start = p.start_date;
    let end = p.end_date;

    if (delta === 0 && !paused && p.end_date < blackoutStart) continue; // finishes before the blackout

    if (delta === 0 && !paused && p.start_date < blackoutStart) {
      // Under way when the blackout begins: work stops, then resumes after it.
      paused = true;
      const worked = countWorkableDays(p.start_date, shiftCalendarDays(blackoutStart, -1), !workable(p));
      const remaining = duration - worked;
      if (remaining > 0) {
        let resume = firstDayAfter;
        if (p.preferred_start_day) resume = nextOccurrenceOfDay(resume, p.preferred_start_day);
        else if (workable(p)) resume = nextWeekday(resume);
        end = addDurationDays(resume, remaining, !workable(p));
        delta = Math.max(0, daysBetween(p.end_date, end));
      }
    } else {
      // Not yet started when the blackout hits (or downstream of a phase that moved).
      let candidate = shiftCalendarDays(p.start_date, delta);
      if (candidate >= blackoutStart && candidate <= blackoutEnd) candidate = firstDayAfter;
      else if (delta === 0 && !(candidate > blackoutEnd)) continue; // entirely before the blackout, nothing pushed
      if (p.preferred_start_day) candidate = nextOccurrenceOfDay(candidate, p.preferred_start_day);
      else if (workable(p)) candidate = nextWeekday(candidate);
      start = candidate;
      end = addDurationDays(start, duration, !workable(p));
      delta = Math.max(0, daysBetween(p.start_date, start));
    }

    if (start !== p.start_date || end !== p.end_date) {
      updates.push({ id: p.id, label: p.label, start_date: start, end_date: end, from_start: p.start_date, from_end: p.end_date });
    }
  }

  // Workdays the finish line moved, for the delay log.
  const lastOld = sorted.reduce((m, p) => (p.end_date > m ? p.end_date : m), '0000-00-00');
  const lastNew = sorted.reduce((m, p) => {
    const d = updates.find(u => u.id === p.id)?.end_date || p.end_date;
    return d > m ? d : m;
  }, '0000-00-00');
  const workdaysShifted = sorted.length && lastNew > lastOld ? countWorkableDays(shiftCalendarDays(lastOld, 1), lastNew, false) : 0;

  return { updates, workdaysShifted, phasesShifted: updates.length };
}

// Applies a blackout to a job's published schedule using whichever Supabase
// client is passed in (service-role from the customer route, the staff
// member's own session from the review card). Also writes a schedule_delays
// entry so the change shows in the job's delay log. Returns the summary.
export async function applyBlackoutToSchedule(client, { jobId, blackoutId, startDate, endDate, actorEmail }) {
  const { data: phases, error } = await client
    .from('job_phases').select('*').eq('job_id', jobId).eq('status', 'published').order('start_date', { ascending: true });
  if (error) throw new Error(error.message);

  const plan = planBlackoutShift(phases || [], startDate, endDate);
  for (const u of plan.updates) {
    const { error: upErr } = await client.from('job_phases').update({ start_date: u.start_date, end_date: u.end_date, updated_at: new Date().toISOString() }).eq('id', u.id);
    if (upErr) throw new Error(upErr.message);
  }

  if (plan.phasesShifted > 0 && plan.workdaysShifted > 0) {
    await client.from('schedule_delays').insert({
      job_id: jobId,
      from_date: startDate,
      workdays_shifted: Math.min(365, plan.workdaysShifted),
      phases_shifted: plan.phasesShifted,
      reason_category: 'customer_change',
      internal_note: `Customer blackout ${startDate} – ${endDate}${blackoutId ? ` (request ${blackoutId})` : ''}`,
      customer_note: null,
      customer_notified: false,
      created_by_email: actorEmail || null,
    });
  }

  const note = plan.phasesShifted === 0
    ? 'No scheduled phases fell in this window — nothing had to move.'
    : `${plan.phasesShifted} phase${plan.phasesShifted === 1 ? '' : 's'} moved; the finish date is about ${plan.workdaysShifted} working day${plan.workdaysShifted === 1 ? '' : 's'} later.`;
  return { ...plan, note };
}
