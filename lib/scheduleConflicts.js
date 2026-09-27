// Pure scheduling logic for the cross-job Schedule Board and the "shift the
// schedule" tool. No database access here — callers pass rows in — so the
// rules can be unit-tested and reused (board, job page, future cron).
//
// A subcontractor is "on" a phase when they hold an issued/accepted work
// order on that job whose trade matches the phase's trade. That's the same
// rule the database uses to decide what a sub can see (sub_visible_phases,
// migration 117), so the board never disagrees with what the sub's own
// calendar shows.

import { countWorkableDays } from './scheduleDates';

export const ACTIVE_WORK_ORDER_STATUSES = ['issued', 'accepted'];

const DAY_MS = 86400000;
const toDate = s => new Date(s + 'T00:00:00');
const iso = d => d.toISOString().slice(0, 10);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

// Move a date forward `n` working days (skipping Sat/Sun), or n plain
// calendar days for a phase that allows weekend work.
export function addWorkdays(dateStr, n, allowWeekends = false) {
  const d = toDate(dateStr);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (allowWeekends || !isWeekend(d)) left--;
  }
  return iso(d);
}

// What changes when the job slips by `workdays` from `fromDate` on:
//   • a phase that hasn't started by fromDate moves entirely;
//   • a phase underway on fromDate keeps its start and its end moves (the
//     work still has to finish, it just finishes later);
//   • finished phases are untouched.
// Returns only the phases that changed, with recomputed duration_days.
export function shiftPhases(phases, fromDate, workdays) {
  const changed = [];
  for (const p of phases) {
    const allow = !!p.allow_weekend_work;
    if (p.start_date >= fromDate) {
      const start = addWorkdays(p.start_date, workdays, allow);
      const end = addWorkdays(p.end_date, workdays, allow);
      changed.push({ ...p, start_date: start, end_date: end, duration_days: countWorkableDays(start, end, allow) });
    } else if (p.end_date >= fromDate) {
      const end = addWorkdays(p.end_date, workdays, allow);
      changed.push({ ...p, end_date: end, duration_days: countWorkableDays(p.start_date, end, allow) });
    }
  }
  return changed;
}

// Number of days in the overlap of two inclusive ranges that both sides
// would actually work (a weekend day only counts when both allow weekends).
export function overlappingWorkdays(aStart, aEnd, bStart, bEnd, aWeekend = false, bWeekend = false) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  let n = 0;
  const cur = toDate(start);
  const last = toDate(end);
  while (cur <= last) {
    if (!isWeekend(cur) || (aWeekend && bWeekend)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

const fmt = s => toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const range = (a, b) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);

// phases:        published job_phases rows { id, job_id, label, trade, start_date, end_date, allow_weekend_work, needs_review }
// jobsById:      { [id]: { project_number, customer_name, project_address } }
// workOrders:    { id, job_id, company_id, trade, status }
// unavailability:{ id, company_id, start_date, end_date, reason }
// compliance:    { [company_id]: { overall } }   (from sub_compliance_overview)
// companies:     { [company_id]: name }
// today:         'YYYY-MM-DD'
export function findConflicts({ phases, jobsById = {}, workOrders = [], unavailability = [], compliance = {}, companies = {}, today, soonDays = 14 }) {
  const out = [];
  const jobLabel = id => {
    const j = jobsById[id] || {};
    return j.project_number ? `#${j.project_number}` : (j.project_address || j.customer_name || 'a job');
  };
  const name = cid => companies[cid] || 'A subcontractor';
  const soon = iso(new Date(toDate(today).getTime() + soonDays * DAY_MS));
  const live = phases.filter(p => p.end_date >= today);

  // Who is on which phase.
  const activeWOs = workOrders.filter(w => w.company_id && ACTIVE_WORK_ORDER_STATUSES.includes(w.status));
  const assignments = []; // { phase, companyId }
  for (const p of live) {
    if (!p.trade) continue;
    const subs = new Set(activeWOs.filter(w => w.job_id === p.job_id && w.trade === p.trade).map(w => w.company_id));
    subs.forEach(companyId => assignments.push({ phase: p, companyId }));
  }

  // 1. Same sub, two jobs, same working days.
  const byCompany = new Map();
  for (const a of assignments) {
    if (!byCompany.has(a.companyId)) byCompany.set(a.companyId, []);
    byCompany.get(a.companyId).push(a.phase);
  }
  for (const [companyId, list] of byCompany) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.job_id === b.job_id) continue;
        const days = overlappingWorkdays(a.start_date, a.end_date, b.start_date, b.end_date, a.allow_weekend_work, b.allow_weekend_work);
        if (days > 0) {
          out.push({
            id: `dbl-${companyId}-${a.id}-${b.id}`, type: 'double_booked', severity: 'high', companyId, phaseIds: [a.id, b.id], jobIds: [a.job_id, b.job_id],
            date: a.start_date > b.start_date ? a.start_date : b.start_date,
            message: `${name(companyId)} is on ${jobLabel(a.job_id)} (${a.label}, ${range(a.start_date, a.end_date)}) and ${jobLabel(b.job_id)} (${b.label}, ${range(b.start_date, b.end_date)}) at the same time — ${days} shared working day${days === 1 ? '' : 's'}.`,
          });
        }
      }
    }
  }

  // 2. Phase lands on days the sub said they can't work.
  for (const a of assignments) {
    for (const u of unavailability.filter(x => x.company_id === a.companyId)) {
      const days = overlappingWorkdays(a.phase.start_date, a.phase.end_date, u.start_date, u.end_date, a.phase.allow_weekend_work, true);
      if (days > 0) {
        out.push({
          id: `una-${u.id}-${a.phase.id}`, type: 'unavailable', severity: 'high', companyId: a.companyId, phaseIds: [a.phase.id], jobIds: [a.phase.job_id],
          date: a.phase.start_date > u.start_date ? a.phase.start_date : u.start_date,
          message: `${name(a.companyId)} is unavailable ${range(u.start_date, u.end_date)}${u.reason ? ` (${u.reason})` : ''} but is scheduled for ${a.phase.label} on ${jobLabel(a.phase.job_id)}, ${range(a.phase.start_date, a.phase.end_date)}.`,
        });
      }
    }
  }

  // 3. Work starting soon (or underway) with a sub whose paperwork isn't in order.
  const seenNoncompliant = new Set();
  for (const a of assignments) {
    if (a.phase.start_date > soon) continue;
    if (compliance[a.companyId]?.overall !== 'noncompliant') continue;
    const key = `${a.companyId}-${a.phase.job_id}`;
    if (seenNoncompliant.has(key)) continue;
    seenNoncompliant.add(key);
    out.push({
      id: `cmp-${key}`, type: 'noncompliant', severity: 'medium', companyId: a.companyId, phaseIds: [a.phase.id], jobIds: [a.phase.job_id], date: a.phase.start_date,
      message: `${name(a.companyId)} is not compliant (insurance/W-9) and is scheduled on ${jobLabel(a.phase.job_id)} starting ${fmt(a.phase.start_date)}.`,
    });
  }

  // 4. Weather/other flags the schedule already carries.
  for (const p of live) {
    if (!p.needs_review) continue;
    out.push({
      id: `rev-${p.id}`, type: 'needs_review', severity: 'medium', phaseIds: [p.id], jobIds: [p.job_id], date: p.start_date,
      message: `${p.label} on ${jobLabel(p.job_id)} (${range(p.start_date, p.end_date)}) is flagged to check — usually weather.`,
    });
  }

  // 5. A trade phase about to start with nobody assigned.
  for (const p of live) {
    if (!p.trade || p.start_date > soon) continue;
    const covered = assignments.some(a => a.phase.id === p.id);
    if (covered) continue;
    out.push({
      id: `uns-${p.id}`, type: 'no_sub', severity: 'info', phaseIds: [p.id], jobIds: [p.job_id], date: p.start_date,
      message: `${p.label} (${p.trade}) on ${jobLabel(p.job_id)} starts ${fmt(p.start_date)} and has no issued or accepted work order for that trade.`,
    });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || (x.date || '').localeCompare(y.date || ''));
}
