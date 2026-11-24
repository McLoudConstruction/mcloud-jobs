// Day 1 steps on a water loss (restoration jobs): arrival safety check, work authorization, walkthrough with the category.
// Pure logic so it can be tested. The screen records the steps; this decides what is done, what is next, and which actions wait.
//
// Hard gates (only the ones that cost a claim, a lawsuit or a lost dehumidifier):
//   extraction, demo -> safety done AND category set (walkthrough)
//   equipment        -> safety done AND work authorization signed (or "customer not present" with the e-sign follow-up open)
// Everything else is advice. The owner and office can always get past a gate by recording the step themselves.

export const SAFETY_CHECKS = [
  ['power', 'Power: affected outlets and panels checked, or shut off'],
  ['structure', 'Structure: ceilings and floors safe to work under'],
  ['slip', 'Slip and trip hazards handled'],
  ['contamination', 'Contamination looked for (sewage, mold, chemicals)'],
  ['occupants', 'Occupants and pets told where not to go'],
];

export const CATEGORIES = [
  [1, 'Category 1', 'Clean source (supply line, rain through a roof leak)'],
  [2, 'Category 2', 'Significant contamination (washer or dishwasher overflow)'],
  [3, 'Category 3', 'Grossly contaminated (sewage, rising floodwater)'],
];

export const STEP_KINDS = ['safety', 'authorization', 'walkthrough'];
export const STEP_LABELS = { safety: 'Safety and source', authorization: 'Work authorization', walkthrough: 'Walkthrough and category' };

// Restoration jobs run Day 1 steps; carpet does not. An unknown service (an older or "other" job) is treated by job type.
export function usesDayOneSteps(service, jobType = '') {
  if (['extraction', 'mitigation', 'remediation'].includes(service)) return true;
  if (!service) return jobType === 'water_restoration';
  return false;
}

// The newest recorded row of each kind: { safety, authorization, walkthrough } (each a row or null)
export function latestByKind(rows = []) {
  const out = { safety: null, authorization: null, walkthrough: null };
  for (const r of [...rows].sort((a, b) => String(a.created_at || a.done_at).localeCompare(String(b.created_at || b.done_at)))) {
    if (r && out[r.kind] !== undefined) out[r.kind] = r;
  }
  return out;
}

// What the safety form needs before it can be recorded: every check ticked and the source answered.
export function missingSafety(data = {}) {
  const miss = [];
  if (!SAFETY_CHECKS.every(([k]) => data.checks?.[k] === true)) miss.push('Tick every safety check.');
  if (data.source_stopped !== true && data.source_stopped !== false) miss.push('Say whether the source of the water is stopped.');
  if (data.source_stopped === false && String(data.source_note || '').trim().length < 3) miss.push('The source is not stopped: say what is being done about it.');
  return miss;
}

export function missingWalkthrough(data = {}) {
  const miss = [];
  if (![1, 2, 3].includes(Number(data.category))) miss.push('Choose the category (1, 2 or 3).');
  if (String(data.reason || '').trim().length < 3) miss.push('Give the reason for the category.');
  return miss;
}

export function cleanSafety(data = {}) {
  const checks = {};
  for (const [k] of SAFETY_CHECKS) checks[k] = data.checks?.[k] === true;
  return {
    checks,
    source_stopped: data.source_stopped === true,
    source_note: String(data.source_note || '').slice(0, 300),
    older_home: data.older_home === true, // built before 1978, or suspect asbestos: lead and asbestos checks before demo
  };
}

export function cleanWalkthrough(data = {}) {
  return { category: Number(data.category), reason: String(data.reason || '').slice(0, 300), photos_taken: data.photos_taken === true };
}

// 'done' | 'absent' (authorization only: no signature, follow-up needed) | 'todo'
export function stepStatus(rows = []) {
  const l = latestByKind(rows);
  return {
    safety: l.safety ? 'done' : 'todo',
    authorization: l.authorization ? (l.authorization.customer_absent ? 'absent' : 'done') : 'todo',
    walkthrough: l.walkthrough ? 'done' : 'todo',
  };
}

export const categoryOf = (rows = []) => {
  const w = latestByKind(rows).walkthrough;
  const c = Number(w?.data?.category);
  return [1, 2, 3].includes(c) ? c : null;
};

// Can this action go ahead? { blocked, reason, step } where step is the Day 1 step that unblocks it.
// action: 'extraction' | 'demo' | 'equipment'. `override` is true for owner and office, who may start the work themselves.
export function gateFor(action, rows = []) {
  const st = stepStatus(rows);
  const needSafety = st.safety !== 'done';
  if (action === 'extraction' || action === 'demo') {
    if (needSafety) return { blocked: true, step: 'safety', reason: 'Do the arrival safety check first. It takes about a minute.' };
    if (st.walkthrough !== 'done') return { blocked: true, step: 'walkthrough', reason: 'Set the category in the walkthrough first. It decides protective gear and handling.' };
    return { blocked: false };
  }
  if (action === 'equipment') {
    if (needSafety) return { blocked: true, step: 'safety', reason: 'Do the arrival safety check before placing equipment.' };
    if (st.authorization === 'todo') return { blocked: true, step: 'authorization', reason: 'Get the work authorization signed before placing equipment. If the customer is not here, choose "Customer not present".' };
    return { blocked: false };
  }
  return { blocked: false };
}

// The one step the tech should do next, as a big button: { step, label, hint } or null when all three are recorded.
export function nextDayOneStep(rows = []) {
  const st = stepStatus(rows);
  if (st.safety === 'todo') return { step: 'safety', label: 'Safety and source check', hint: 'Before any work starts' };
  if (st.authorization === 'todo') return { step: 'authorization', label: 'Work authorization', hint: 'Customer signs before demo or equipment' };
  if (st.walkthrough === 'todo') return { step: 'walkthrough', label: 'Walkthrough and category', hint: 'Initial photos in each affected room, then the category' };
  return null;
}

// Items for the office's "missing" list on the job: things not finished that a carrier packet needs.
export function missingDayOne(rows = []) {
  const st = stepStatus(rows);
  const out = [];
  if (st.safety === 'todo') out.push('Arrival safety check not recorded');
  if (st.authorization === 'todo') out.push('Work authorization not signed');
  if (st.authorization === 'absent') out.push('Work authorization unsigned: customer was not present, send an e-sign link');
  if (st.walkthrough === 'todo') out.push('Category not set');
  return out;
}

// Finish visit versus Complete job. A restoration visit that finishes leaves the job open (drying takes several visits).
// The job can be completed once no visit is still planned or under way.
export function canCompleteJob({ jobStatus, activeVisits = 0 }) {
  if (['completed', 'closed', 'cancelled'].includes(jobStatus)) return { ok: false, reason: 'This job is already finished.' };
  if (activeVisits > 0) return { ok: false, reason: 'A visit is still planned or under way. Finish or cancel it first.' };
  return { ok: true };
}
