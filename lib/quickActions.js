// The Job Quick Action Screen: every action a tech may need on a job, in one place of big buttons.
// Pure logic so it can be tested. The page decides what each key does; this decides which keys show.
//   service:     carpet | extraction | mitigation | remediation | '' (unknown shows the widest set)
//   visitStatus: status of the visit the person can act on (scheduled | on_the_way | started), or null
//   jobStatus:   the job's status
//   clock:       'out' (this person's clock is running), 'in' (visit under way, clock stopped) or null
//   tabs:        keys of the job tabs this person can open (an action that opens a tab only shows if the tab does)
//   hasSketch:   the job has a sketch (Recheck needs one)
//   canStart:    this person is the team member the visit is assigned to (only they get Start job)
// Each action: { key, label, hint, group }. Groups: 'now' (the next step), 'work', 'job'.

export const QUICK_LABELS = {
  otw: ['On the way', 'Tell the customer how far out you are'],
  eta: ['Update ETA', 'Running late? Send a new time'],
  start: ['Start job', 'Starts the job clock'],
  finish: ['Finish job', 'Stops the clock and completes the visit'],
  finish_visit: ['Finish visit', 'Stops the clock. The job stays open'],
  dayone: ['Day 1 steps', 'Safety, authorization, category'],
  complete_job: ['Complete job', 'Every visit is finished'],
  clock_in: ['Clock in', 'Back from lunch or a break'],
  clock_out: ['Clock out', 'Lunch or a break'],
  photos: ['Take photos', 'Camera'],
  inspection: ['Inspection', 'Walk-through with photos, before and after'],
  evalsheet: ['Eval sheet', 'One sheet per unit'],
  sketch: ['Sketch', 'Draw the rooms'],
  moisture: ['Moisture', 'Readings and equipment'],
  recheck: ['Recheck', 'Readings on a return visit'],
  estimate: ['Estimate', 'Show or change the price'],
  invoice: ['Invoice', 'Bill and take payment'],
  costs: ['Costs', 'Purchases, equipment, time'],
  chat: ['Chat', 'Message the office or crew'],
  details: ['Details', 'Job details and notes'],
};

const TAB_ACTIONS = new Set(['inspection', 'evalsheet', 'sketch', 'moisture', 'estimate', 'invoice', 'costs', 'details']);
export const isTabAction = (k) => TAB_ACTIONS.has(k);

export function quickActions({ service = '', visitStatus = null, jobStatus = '', clock = null, tabs = [], hasSketch = false, canStart = true, dayOne = false, restoration = false, canComplete = false } = {}) {
  const has = (k) => tabs.includes(k);
  const carpet = service === 'carpet';
  const out = [];
  const add = (key, group) => { if (QUICK_LABELS[key] && !out.some((a) => a.key === key)) out.push({ key, label: QUICK_LABELS[key][0], hint: QUICK_LABELS[key][1], group }); };
  const closed = ['closed', 'cancelled'].includes(jobStatus);

  // the next step
  if (!closed) {
    if (visitStatus === 'scheduled') { add('otw', 'now'); if (canStart) add('start', 'now'); }
    else if (visitStatus === 'on_the_way') { if (canStart) add('start', 'now'); add('eta', 'now'); }
    else if (visitStatus === 'started') {
      if (clock === 'out') add('clock_out', 'now'); else if (clock === 'in') add('clock_in', 'now');
      add(restoration ? 'finish_visit' : 'finish', 'now');
    }
    if (canComplete && visitStatus !== 'started') add('complete_job', 'now');
  }

  // the work, by kind of job
  if (!closed) {
    if (dayOne) add('dayone', 'work');
    add('photos', 'work');
    if (carpet) {
      if (has('inspection')) add('inspection', 'work');
      if (has('evalsheet')) add('evalsheet', 'work');
      if (has('sketch')) add('sketch', 'work');
      if (has('estimate')) add('estimate', 'work');
    } else {
      if (has('sketch')) add('sketch', 'work');
      if (has('moisture')) add('moisture', 'work');
      if (has('moisture') && hasSketch) add('recheck', 'work');
      if (has('estimate')) add('estimate', 'work');
    }
  }

  // the job
  add('chat', 'job');
  if (has('invoice')) add('invoice', 'job');
  if (has('costs')) add('costs', 'job');
  if (has('details')) add('details', 'job');
  return out;
}

// Names shown in the header of a screen opened from Quick Actions (the tab key it opens -> its title)
export const QA_SCREEN_TITLES = {
  inspection: 'Inspection', evalsheet: 'Eval sheet', sketch: 'Sketch', moisture: 'Moisture', estimate: 'Estimate',
  invoice: 'Invoice', costs: 'Costs', details: 'Details', photos: 'Photos', updates: 'Updates', thread: 'Chat', reports: 'Reports', history: 'History',
};
export const qaScreenTitle = (tab, fallback = '') => QA_SCREEN_TITLES[tab] || fallback || 'Job';
