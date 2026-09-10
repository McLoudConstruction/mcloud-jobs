// Central map of which staff roles can access which parts of the app.
// Checked in one place (useRequireAuth, on every page load) rather than
// per-page, and used again by AppShell to decide what to show in the
// nav — change access here, not in individual page files.

export const ROLES = ['owner', 'general_manager', 'project_manager', 'bookkeeper'];

export const ROLE_LABELS = {
  owner: 'Owner',
  general_manager: 'General Manager',
  project_manager: 'Project Manager',
  bookkeeper: 'Bookkeeper',
};

// Route prefixes checked most-specific-first. `roles: null` means every
// active staff role can access it. A route with no matching rule falls
// back to DEFAULT_ROLES below — update this list when a new top-level
// section is added to AppShell's NAV_ITEMS.
const ROUTE_RULES = [
  { prefix: '/settings', roles: ['owner'] },
  { prefix: '/financials', roles: ['owner', 'general_manager', 'bookkeeper'] },
  { prefix: '/invoices', roles: ['owner', 'general_manager', 'project_manager', 'bookkeeper'] },
  { prefix: '/sales', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/customers', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/properties', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/companies', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/subcontractors', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/estimating', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/material-selections', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/capture', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/jobs', roles: ['owner', 'general_manager', 'project_manager'] },
  { prefix: '/dashboard', roles: null },
  { prefix: '/messages', roles: null },
  { prefix: '/notifications', roles: null },
];

// Unlisted routes (new pages not yet added above) default to open, so a
// forgotten entry doesn't accidentally lock everyone out — but every
// real section above is enumerated explicitly rather than relying on
// this default for anything that actually matters.
const DEFAULT_ROLES = null;

export function canAccessPath(role, pathname) {
  if (!role) return false;
  if (role === 'owner') return true;
  const rule = ROUTE_RULES.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  const roles = rule ? rule.roles : DEFAULT_ROLES;
  if (!roles) return true;
  return roles.includes(role);
}
