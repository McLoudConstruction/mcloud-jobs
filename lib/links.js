// Single source of truth for links that point INTO a job page, between the
// app's top-level pages, or into Settings.
//
// Why this exists: job-page deep links used to be hand-typed strings
// (`/jobs/${id}?tab=Financials&section=...`) in ~15 files. Every time the
// job page's tabs moved, some of those strings quietly broke (lowercase
// `?tab=schedule`, a `section=proposals` that never existed, a `#Financials`
// hash nothing reads). Everything now goes through jobHref()/appHref(), and
// scripts/check-links.mjs fails the build if a raw `?tab=` string shows up
// anywhere else.
//
// Callers name a DESTINATION ("workOrders", "budget"), never a tab/section
// pair. If a feature moves, change its row in JOB_DESTINATIONS and every
// link follows. Old bookmarks keep working through normalizeJobLink().
// scripts/check-link-destinations.mjs fails the build if a destination
// points at a tab/section that does not exist on the job page.

// ---------------------------------------------------------------------------
// The job page is organised by when things happen in a project:
//   Sell      winning the work   (scope, cost, pricing, plans)
//   Plan      getting ready      (budget, material selections, work orders)
//   Build     doing the work     (updates, change orders, job costs, draws, pay apps, waivers)
//   Closeout  finishing up       (punch list, warranty, final invoice, review)
// plus tabs that matter at every stage: Overview, Schedule, Photos,
// Documents, Messages.
// ---------------------------------------------------------------------------
export const JOB_DESTINATIONS = {
  overview:         { tab: 'Overview', section: 'summary' },
  customer:         { tab: 'Overview', section: 'customer' },
  // Portal access and notification settings are a second view inside the
  // Customer section (the `view` param), not a section of their own.
  portal:           { tab: 'Overview', section: 'customer', view: 'portal' },
  jobFinancials:    { tab: 'Overview', section: 'financials' },

  // Sell. The estimate and contract buttons sit on Scope, Cost and Pricing,
  // so "proposals" and "contract" open Scope instead of a section of their own.
  scope:            { tab: 'Sell', section: 'scope' },
  cost:             { tab: 'Sell', section: 'cost' },
  pricing:          { tab: 'Sell', section: 'pricing' },
  proposals:        { tab: 'Sell', section: 'scope' },
  contract:         { tab: 'Sell', section: 'scope' },
  floorplan:        { tab: 'Sketch' },

  // Plan
  budget:           { tab: 'Plan', section: 'budget' },
  approvedMaterials:{ tab: 'Plan', section: 'approved' },
  selections:       { tab: 'Plan', section: 'all' },
  workOrders:       { tab: 'Plan', section: 'work_orders' },

  // Build
  updates:          { tab: 'Build', section: 'updates' },
  internalUpdates:  { tab: 'Build', section: 'internal' },
  changeOrders:     { tab: 'Build', section: 'change_orders' },
  jobCosts:         { tab: 'Build', section: 'job_costs' },
  draws:            { tab: 'Build', section: 'draws' },
  payApps:          { tab: 'Build', section: 'pay_apps' },
  waivers:          { tab: 'Build', section: 'waivers' },

  // Closeout
  punchList:        { tab: 'Closeout', section: 'punch' },
  warranty:         { tab: 'Closeout', section: 'warranty' },
  finalInvoice:     { tab: 'Closeout', section: 'invoice' },
  reviews:          { tab: 'Closeout', section: 'review' },

  // Always available
  schedule:         { tab: 'Schedule' },
  photos:           { tab: 'Photos' },
  sketch:           { tab: 'Sketch' },
  documents:        { tab: 'Documents' },
  messages:         { tab: 'Messages', section: 'messages' },
  email:            { tab: 'Messages', section: 'email' },
};

// ---------------------------------------------------------------------------
// Where a job opens when nothing in the URL says otherwise: the stage it is in.
// An explicit link (jobHref with a destination) always wins over this.
// ---------------------------------------------------------------------------
export const STAGE_LANDING = {
  new:                { tab: 'Overview', section: 'customer' },
  inspected:          { tab: 'Sell',     section: 'scope' },
  proposal_delivered: { tab: 'Sell',     section: 'scope' },
  lost:               { tab: 'Overview', section: 'summary' },
  approved:           { tab: 'Plan',     section: 'budget' },
  scheduled:          { tab: 'Plan',     section: 'work_orders' },
  active:             { tab: 'Build',    section: 'updates' },
  completed:          { tab: 'Closeout', section: 'punch' },
  invoiced:           { tab: 'Closeout', section: 'invoice' },
  paid:               { tab: 'Closeout', section: 'review' },
};

export function stageLanding(stage) {
  return STAGE_LANDING[stage] || { tab: 'Overview' };
}

export function stageTab(stage) {
  return stageLanding(stage).tab;
}

// "Take me to this job's billing": progress draws while the work is going on,
// the final invoice once it is done.
export function billingDestination(stage) {
  return ['completed', 'invoiced', 'paid'].includes(stage) ? 'finalInvoice' : 'draws';
}

function toQuery(entries) {
  const q = new URLSearchParams();
  for (const [k, v] of entries) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// jobHref('abc', 'workOrders')                -> /jobs/abc?tab=Plan&section=work_orders
// jobHref('abc', 'portal')                    -> /jobs/abc?tab=Overview&section=customer&view=portal
// jobHref('abc', 'cost', { costOption: 'x' }) -> ...&costOption=x
// jobHref('abc')                              -> /jobs/abc (opens on the job's current stage)
export function jobHref(jobId, destination, extraParams) {
  const base = `/jobs/${jobId}`;
  if (!destination) return base + toQuery(Object.entries(extraParams || {}));
  const d = JOB_DESTINATIONS[destination];
  if (!d) {
    // A typo here should be loud in development and harmless in production.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`jobHref: unknown destination "${destination}"`);
    }
    return base;
  }
  return base + toQuery([['tab', d.tab], ['section', d.section], ['view', d.view], ...Object.entries(extraParams || {})]);
}

// ---------------------------------------------------------------------------
// Old URLs. Before the stage restructure the job page had these tabs:
//   Customer, Estimate, Financials, Material Selections, Project Updates,
//   Internal Updates, Email  (all now folded into the tabs above)
// Bookmarks, emailed links and browser history still carry them, so the job
// page runs every ?tab=&section= through normalizeJobLink() first. It is also
// forgiving about letter case and retired section names.
//   tabs     - the job page's TABS array (so this file never has its own copy)
//   rawTab   - value of ?tab=
//   rawSect  - value of ?section=
// Returns { tab, section[, view][, stageAware] } using real keys (section may be
// null), or null if the tab is unknown. stageAware: 'billing' means "send them
// to draws or the final invoice depending on the job's stage" (the old
// Financials > Invoices section held both).
// ---------------------------------------------------------------------------
const lc = s => String(s ?? '').trim().toLowerCase();

const LEGACY_FINANCIALS = {
  overview:      { tab: 'Overview', section: 'financials' },
  budget:        { tab: 'Plan', section: 'budget' },
  work_orders:   { tab: 'Plan', section: 'work_orders' },
  change_orders: { tab: 'Build', section: 'change_orders' },
  receipts:      { tab: 'Build', section: 'job_costs' },
  pay_apps:      { tab: 'Build', section: 'pay_apps' },
  waivers:       { tab: 'Build', section: 'waivers' },
  invoicing:     { tab: 'Build', section: 'draws', stageAware: 'billing' },
};

const LEGACY_TABS = {
  customer:             s => (s === 'portal' ? { tab: 'Overview', section: 'customer', view: 'portal' } : { tab: 'Overview', section: 'customer' }),
  estimate:             s => ({ tab: 'Sell', section: { cost: 'cost', pricing: 'pricing' }[s] || 'scope' }),
  financials:           s => LEGACY_FINANCIALS[s] || { tab: 'Overview', section: 'financials' },
  'material selections': s => ({ tab: 'Plan', section: s === 'all' ? 'all' : 'approved' }),
  'project updates':    () => ({ tab: 'Build', section: 'updates' }),
  'internal updates':   () => ({ tab: 'Build', section: 'internal' }),
  email:                () => ({ tab: 'Messages', section: 'email' }),
};

// Alternate names accepted for sections of tabs that still exist.
const SECTION_ALIASES = {
  Overview: { customer: 'customer', details: 'customer', financials: 'financials', overview: 'summary' },
  Sell:     { estimate: 'scope', proposals: 'scope', proposal: 'scope', contract: 'scope' },
  Closeout: { invoicing: 'invoice', 'final invoice': 'invoice', reviews: 'review' },
  Build:    { receipts: 'job_costs', 'job costs': 'job_costs', invoicing: 'draws' },
};

// Sections that used to be on a tab that still exists but now live somewhere
// else. Checked before the generic alias lookup.
const MOVED_SECTIONS = {
  sell: {
    portal: { tab: 'Overview', section: 'customer', view: 'portal' },
    // Plans became the Sketch tab (job-level, beside Schedule and Photos).
    floorplan: { tab: 'Sketch' },
  },
};

export function normalizeJobLink(tabs, rawTab, rawSect, rawView) {
  if (!rawTab) return null;
  const t = lc(rawTab);
  const s = lc(rawSect);

  let target = null;
  const isCurrentTab = tabs.some(x => lc(x.key) === t);
  if (!isCurrentTab && LEGACY_TABS[t]) {
    target = LEGACY_TABS[t](s);
  } else if (MOVED_SECTIONS[t]?.[s]) {
    target = MOVED_SECTIONS[t][s];
  } else {
    const tab = tabs.find(x => lc(x.key) === t);
    if (!tab) return null;
    target = { tab: tab.key, section: SECTION_ALIASES[tab.key]?.[s] || rawSect || null };
  }

  const tabDef = tabs.find(x => x.key === target.tab);
  if (!tabDef) return null;
  let section = null;
  if (tabDef.sections && target.section) {
    const match = tabDef.sections.find(x => lc(x.key) === lc(target.section));
    section = match ? match.key : null;
  }
  // `view` only means something inside Overview > Customer.
  const view = (target.view || lc(rawView)) === 'portal' && tabDef.key === 'Overview' && section === 'customer' ? 'portal' : null;
  return { tab: tabDef.key, section, ...(view ? { view } : {}), ...(target.stageAware ? { stageAware: target.stageAware } : {}) };
}

// ---------------------------------------------------------------------------
// Top-level pages. Keeping the paths here means moving a page is a one-line
// change instead of a repo-wide search.
// ---------------------------------------------------------------------------
export const APP_ROUTES = {
  calendar:         '/jobs/calendar',
  calendarBoard:    '/jobs/calendar/board',
  calendarOverview: '/jobs/calendar/overview',
  estimating:       '/estimating',
  assemblies:       '/estimating/assemblies',
  rfps:             '/subcontractors/rfps',
  materialSelections: '/material-selections',
  workOrders:       '/subcontractors/work-orders',
  invoices:         '/invoices',
  reviews:          '/reviews',
  routeBuilder:     '/sales/routes',
  weatherRisk:      '/weather-risk',
  floorplan:        '/floorplan',
  deferredScope:    '/deferred-scope',
};

export function appHref(key, params) {
  const path = APP_ROUTES[key];
  if (!path) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`appHref: unknown route "${key}"`);
    }
    return '/dashboard';
  }
  return path + toQuery(Object.entries(params || {}));
}

// Settings has its own ?tab= (Integrations, etc.), separate from job tabs.
export function settingsHref(tab) {
  return `/settings${toQuery([['tab', tab]])}`;
}
