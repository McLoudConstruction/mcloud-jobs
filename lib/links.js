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

// ---------------------------------------------------------------------------
// Job destinations: semantic key -> where it lives on the job page right now.
// ---------------------------------------------------------------------------
export const JOB_DESTINATIONS = {
  overview:        { tab: 'Overview' },

  // Customer
  customer:        { tab: 'Customer', section: 'details' },
  portal:          { tab: 'Customer', section: 'portal' },

  // Estimate / sell side
  scope:           { tab: 'Estimate', section: 'scope' },
  cost:            { tab: 'Estimate', section: 'cost' },
  pricing:         { tab: 'Estimate', section: 'pricing' },
  // The estimate document and the contract are both generated from buttons
  // on the Estimate tab header, so that is where their "back" lands.
  proposals:       { tab: 'Estimate', section: 'pricing' },
  contract:        { tab: 'Estimate', section: 'pricing' },

  // Schedule
  schedule:        { tab: 'Schedule' },

  // Money, by what it is
  jobFinancials:   { tab: 'Financials', section: 'overview' },
  budget:          { tab: 'Financials', section: 'budget' },
  changeOrders:    { tab: 'Financials', section: 'change_orders' },
  workOrders:      { tab: 'Financials', section: 'work_orders' },
  draws:           { tab: 'Financials', section: 'invoicing' },
  finalInvoice:    { tab: 'Financials', section: 'invoicing' },
  invoicing:       { tab: 'Financials', section: 'invoicing' }, // job-level "its billing", draws or final
  payApps:         { tab: 'Financials', section: 'pay_apps' },
  waivers:         { tab: 'Financials', section: 'waivers' },
  jobCosts:        { tab: 'Financials', section: 'receipts' },

  // Closeout
  punchList:       { tab: 'Closeout', section: 'punch' },
  warranty:        { tab: 'Closeout', section: 'warranty' },

  // Field + communication
  selections:      { tab: 'Material Selections' },
  updates:         { tab: 'Project Updates' },
  internalUpdates: { tab: 'Internal Updates' },
  photos:          { tab: 'Photos' },
  documents:       { tab: 'Documents' },
  messages:        { tab: 'Messages' },
  email:           { tab: 'Email' },
};

function toQuery(entries) {
  const q = new URLSearchParams();
  for (const [k, v] of entries) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// jobHref('abc', 'workOrders')                -> /jobs/abc?tab=Financials&section=work_orders
// jobHref('abc', 'cost', { costOption: 'x' }) -> ...&costOption=x
// jobHref('abc')                              -> /jobs/abc (the job's own default tab)
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
  return base + toQuery([['tab', d.tab], ['section', d.section], ...Object.entries(extraParams || {})]);
}

// The "← Back" fallback on printable document pages: admins return to the
// right spot in the job, customers/subs return to their portal.
export function docBackHref({ isAdmin, jobId, destination }) {
  return isAdmin ? jobHref(jobId, destination) : '/customerportal/projects';
}

// ---------------------------------------------------------------------------
// Old URLs. The job page reads ?tab=&section= on load; this makes that
// tolerant of case, stale section names and anything else that used to exist,
// so bookmarks and emailed links never land on a blank pane.
//   tabs     - the job page's TABS array (so this file never has its own copy)
//   rawTab   - value of ?tab=
//   rawSect  - value of ?section=
// Returns { tab, section } using real keys (section may be null), or null if
// the tab is unknown.
// ---------------------------------------------------------------------------
const LEGACY_SECTION_ALIASES = {
  // 'proposals' was linked to from the estimate document but never existed
  Estimate: { proposals: 'pricing', proposal: 'pricing', contract: 'pricing' },
};

export function normalizeJobLink(tabs, rawTab, rawSect) {
  if (!rawTab) return null;
  const lc = s => String(s).trim().toLowerCase();
  const tab = tabs.find(t => lc(t.key) === lc(rawTab));
  if (!tab) return null;
  let section = rawSect || null;
  if (section && tab.sections) {
    const aliased = LEGACY_SECTION_ALIASES[tab.key]?.[lc(section)] || section;
    const match = tab.sections.find(s => lc(s.key) === lc(aliased));
    section = match ? match.key : null;
  } else if (!tab.sections) {
    section = null;
  }
  return { tab: tab.key, section };
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
