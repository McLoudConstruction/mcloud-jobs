'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { DashboardIcon, SalesIcon, JobDashboardIcon, SubcontractorsIcon, FinanceIcon, SettingsIcon, SignOutIcon, MessagesIcon, SunIcon, MoonIcon, UserIcon, ScheduleIcon, MoreIcon, BellIcon, RefreshIcon } from './icons';
import { useTheme } from '../lib/useTheme';
import { useStaffAuth } from '../lib/staffAuthContext';
import { canAccessPath, ROLE_LABELS } from '../lib/permissions';
import { initialsFor, displayNameFor } from '../lib/userDisplay';
import { startPhotoQueueWatchers } from '../lib/jobPhotos';
import ScrollFadeRow from './ScrollFadeRow';
import BottomSheet from './BottomSheet';
import JobJumpSearch from './JobJumpSearch';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  {
    href: '/sales',
    label: 'Sales',
    icon: SalesIcon,
    children: [
      { href: '/customers', label: 'People' },
      { href: '/properties', label: 'Properties' },
      { href: '/companies', label: 'Companies' },
      { href: '/sales/routes', label: 'Route Builder' },
      { href: '/deferred-scope', label: 'Deferred Scope' },
    ],
  },
  {
    href: '/jobs',
    label: 'Projects',
    icon: JobDashboardIcon,
    children: [
      { href: '/estimating', label: 'Estimating' },
      { href: '/invoices', label: 'Invoicing' },
      { href: '/material-selections', label: 'Material Selections' },
      { href: '/reviews', label: 'Reviews' },
      { href: '/estimating/assemblies', label: 'Assemblies' },
      { href: '/floorplan', label: 'Sketch' },
    ],
  },
  { href: '/jobs/calendar', label: 'Schedule', icon: ScheduleIcon },
  {
    href: '/subcontractors',
    label: 'Subcontractors',
    icon: SubcontractorsIcon,
    children: [
      { href: '/subcontractors/work-orders', label: 'Work Orders' },
      { href: '/subcontractors/rfps', label: 'RFPs' },
    ],
  },
  {
    href: '/messages',
    label: 'Inbox',
    icon: MessagesIcon,
    children: [
      { href: '/notifications', label: 'Notifications' },
    ],
  },
  {
    href: '/financials',
    label: 'Financials',
    icon: FinanceIcon,
    children: [
      { href: '/financials/payable', label: 'Accounts Payable' },
      { href: '/financials/receivable', label: 'Accounts Receivable' },
    ],
  },
];

// The bottom nav caps at 5 icons on mobile (the sidebar itself is untouched
// — it already fits the full NAV_ITEMS list at 900px+). Four destinations
// stay directly on the bar; everything else — Inbox, Subcontractors,
// Financials, Settings, plus Theme/Sign out, which otherwise have no home
// at all on mobile since the sidebar that carries them is hidden below
// 900px — moves into the "More" sheet.
const MOBILE_PRIMARY_HREFS = ['/dashboard', '/sales', '/jobs/calendar', '/jobs'];
const MORE_SHEET_ITEMS = [
  { href: '/messages', label: 'Inbox', icon: MessagesIcon, showUnreadDot: true },
  { href: '/subcontractors', label: 'Subcontractors', icon: SubcontractorsIcon },
  { href: '/financials', label: 'Financials', icon: FinanceIcon },
  { href: '/settings/account', label: 'Account', icon: UserIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

function isSectionActive(item, pathname) {
  if (pathname === item.href) return true;
  if (item.children && item.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) return true;
  if (!pathname.startsWith(item.href + '/')) return false;
  // The prefix fallback above is what lets e.g. /jobs/{id} still highlight
  // Projects. But Schedule's own href ('/jobs/calendar') sits under that
  // same '/jobs/' prefix, so without this check both Projects and Schedule
  // would light up together on the calendar page. If a sibling top-level
  // item's own href is a more specific match for this path, it wins and
  // this item is not active.
  const claimedBySibling = NAV_ITEMS.some(other => other !== item && (pathname === other.href || pathname.startsWith(other.href + '/')));
  return !claimedBySibling;
}

function getCurrentSection(pathname) {
  return NAV_ITEMS.find(item => item.children && isSectionActive(item, pathname)) || null;
}

// The section-subnav strip (Overview + children tabs) should only render on
// the section's own top-level pages. Individual job detail pages and other
// nested routes (e.g. /jobs/{id}, /jobs/calendar) live under the same '/jobs/'
// prefix for icon-highlighting purposes but have their own internal tab nav,
// so showing this strip there duplicated navigation. This is intentionally
// stricter than isSectionActive, which still drives sidebar/bottomnav
// highlighting.
function shouldShowSubnav(item, pathname) {
  if (!item) return false;
  if (pathname === item.href) return true;
  return item.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'));
}

// /settings/account is its own More-sheet entry, so it must not also light up
// the broader /settings entry.
function isMoreItemActive(item, pathname) {
  if (item.href === '/settings' && pathname.startsWith('/settings/account')) return false;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

function isMoreSheetActive(pathname) {
  return MORE_SHEET_ITEMS.some(item => isMoreItemActive(item, pathname));
}

// `sidebar` (optional, desktop only) replaces the area's own page list in the
// left sidebar. The job page uses it to show its stage and section tree.
export default function AppShell({ children, sidebar }) {
  const { theme, setTheme } = useTheme();
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  // The account button shows the signed-in person's first and last initial,
  // and the menu opens with their full name.
  const { fullName, email, role } = useStaffAuth();
  const userInitials = initialsFor(fullName, email);
  const userName = displayNameFor(fullName, email);
  const roleLabel = role ? (ROLE_LABELS[role] || role) : '';
  const canOpenSettings = canAccessPath(role, '/settings');

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = e => { if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [accountOpen]);

  // Resume any photos left in the local upload queue, on every page.
  useEffect(() => startPhotoQueueWatchers(), []);

  useEffect(() => {
    let mounted2 = true;
    async function loadUnread() {
      const [{ count: notifCount }, { count: questionCount }] = await Promise.all([
        supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('read', false).eq('dismissed', false),
        supabase.from('job_questions').select('*', { count: 'exact', head: true }).eq('sender', 'customer').is('read_at', null),
      ]);
      if (mounted2) setUnreadCount((notifCount || 0) + (questionCount || 0));
    }
    loadUnread();
    const channel = supabase
      .channel('shell-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadUnread)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, loadUnread)
      .subscribe();
    return () => { mounted2 = false; supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    function checkSize() {
      setIsMobile(window.innerWidth < 900);
    }
    checkSize();
    setMounted(true);
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // Sitewide "push now" — a manual stand-in for waiting on the scheduled
  // cron sync, available from anywhere instead of just Settings →
  // Integrations. Reuses the same sync-now route/endpoint that page's own
  // "Sync Now" button calls (requires an owner session; a non-owner
  // account gets a plain failure toast rather than a confusing error).
  async function handleRefreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/integrations/calendar-sync-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed.');
      const pushed = (data.results || []).reduce((sum, r) => sum + (r.pushed || 0) + (r.pushedBidWalks || 0) + (r.pushedScheduleEvents || 0), 0);
      setRefreshMsg(`Synced — ${pushed} calendar event${pushed === 1 ? '' : 's'} pushed.`);
    } catch (err) {
      setRefreshMsg(err.message || 'Refresh failed.');
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(''), 4000);
    }
  }

  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  // Computer layout: main nav lives in the top bar, and the left sidebar holds
  // whatever belongs to the area you are in. Phones keep the bottom nav.
  const showDesktopNav = mounted && !isMobile;
  const currentSection = getCurrentSection(pathname);
  // Messages' only child is Notifications, which the Inbox page (both
  // mobile and now desktop) merges into its own All/Messages/System chip
  // row — showing this top-level Overview/Notifications strip on top of
  // that would just duplicate the same switch with a second, redundant
  // control.
  const showSubnav = shouldShowSubnav(currentSection, pathname) && currentSection?.href !== '/messages';

  const areaNav = showSubnav && (
    <nav className="area-nav">
      <div className="area-nav-title">{currentSection.label}</div>
      <Link href={currentSection.href} className={`area-nav-link ${pathname === currentSection.href ? 'active' : ''}`}>Overview</Link>
      {currentSection.children.map(child => (
        <Link key={child.href} href={child.href} className={`area-nav-link ${pathname === child.href || pathname.startsWith(child.href + '/') ? 'active' : ''}`}>
          {child.label}
        </Link>
      ))}
    </nav>
  );
  const asideContent = showDesktopNav ? (sidebar || areaNav || null) : null;

  const subnavStrip = showSubnav && (
    <ScrollFadeRow trackClassName="section-subnav">
      <Link href={currentSection.href} className={`stage-tab ${pathname === currentSection.href ? 'active' : ''}`}>Overview</Link>
      {currentSection.children.map(child => (
        <Link key={child.href} href={child.href} className={`stage-tab ${pathname === child.href || pathname.startsWith(child.href + '/') ? 'active' : ''}`}>
          {child.label}
        </Link>
      ))}
    </ScrollFadeRow>
  );

  return (
    <div className="shell">
      <div className="shell-topbar">
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 32, width: 'auto' }} />
            : <span className="brand">McLoud <span>Jobs</span></span>}
        </div>
        {showDesktopNav && (
          <nav className="shell-topnav" aria-label="Main">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`shell-topnav-link ${isSectionActive(item, pathname) ? 'active' : ''}`}
                aria-current={isSectionActive(item, pathname) ? 'page' : undefined}
              >
                {item.label}
                {item.href === '/messages' && unreadCount > 0 && <span className="shell-topnav-dot" />}
              </Link>
            ))}
          </nav>
        )}
        <div className="shell-topbar-actions">
          {showDesktopNav && <JobJumpSearch />}
          <button
            type="button"
            className={`shell-topbar-icon-btn ${refreshing ? 'spinning' : ''}`}
            onClick={handleRefreshNow}
            aria-label="Refresh now"
            title="Push a sync now instead of waiting for the scheduled cron"
          >
            <RefreshIcon />
            {refreshMsg && <span className="shell-topbar-toast">{refreshMsg}</span>}
          </button>
          <Link href="/messages" className="shell-topbar-icon-btn" aria-label="Notifications">
            <BellIcon />
            {unreadCount > 0 && <span className="shell-topbar-dot" />}
          </Link>
          {showDesktopNav && (
            <div ref={accountRef} className="shell-account">
              <button
                type="button"
                className="shell-account-btn"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label={userName ? `Account menu for ${userName}` : 'Account menu'}
                title={userName || undefined}
                onClick={() => setAccountOpen(o => !o)}
              >
                {userInitials}
              </button>
              {accountOpen && (
                <div className="shell-account-menu" role="menu">
                  <div className="shell-account-head">
                    <div className="shell-account-name">{userName || 'Signed in'}</div>
                    {(roleLabel || email) && (
                      <div className="shell-account-sub">{roleLabel}{roleLabel && email ? ' · ' : ''}{email && email !== userName ? email : ''}</div>
                    )}
                  </div>
                  <div className="shell-account-divider" />
                  <Link href="/settings/account" role="menuitem" className="shell-account-item" onClick={() => setAccountOpen(false)}>
                    <UserIcon className="shell-account-icon" />
                    Account
                  </Link>
                  <button type="button" role="menuitem" className="shell-account-item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setAccountOpen(false); }}>
                    {theme === 'dark' ? <MoonIcon className="shell-account-icon" /> : <SunIcon className="shell-account-icon" />}
                    {theme === 'dark' ? 'Dark mode' : 'Light mode'}
                  </button>
                  {canOpenSettings && (
                    <Link href="/settings" role="menuitem" className="shell-account-item" onClick={() => setAccountOpen(false)}>
                      <SettingsIcon className="shell-account-icon" />
                      Settings
                    </Link>
                  )}
                  <div className="shell-account-divider" />
                  <button type="button" role="menuitem" className="shell-account-item" onClick={handleSignOut}>
                    <SignOutIcon className="shell-account-icon" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shell-body">
        {asideContent && (
          <aside className="shell-sidebar shell-sidebar-wide" aria-label={sidebar ? 'Page navigation' : `${currentSection.label} pages`}>
            {asideContent}
          </aside>
        )}

        {isMobile && (
          <nav className="shell-bottomnav">
            {NAV_ITEMS.filter(item => MOBILE_PRIMARY_HREFS.includes(item.href)).map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`shell-bottomnav-link ${isSectionActive(item, pathname) ? 'active' : ''}`}
                aria-label={item.label}
              >
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <item.icon className="shell-bottomnav-icon" />
                </span>
                <span className="shell-bottomnav-label">{item.label}</span>
              </Link>
            ))}
            <button
              type="button"
              className={`shell-bottomnav-link ${isMoreSheetActive(pathname) ? 'active' : ''}`}
              aria-label="More"
              onClick={() => setMoreOpen(true)}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <MoreIcon className="shell-bottomnav-icon" />
                {unreadCount > 0 && <span className="shell-bottomnav-dot" />}
              </span>
              <span className="shell-bottomnav-label">More</span>
            </button>
          </nav>
        )}

        <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          {MORE_SHEET_ITEMS.filter(item => canAccessPath(role, item.href)).map(item => {
            const active = isMoreItemActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`more-sheet-link ${active ? 'active' : ''}`}
                onClick={() => setMoreOpen(false)}
              >
                <item.icon className="more-sheet-icon" />
                {item.label}
                {item.showUnreadDot && unreadCount > 0 && <span className="more-sheet-dot" />}
              </Link>
            );
          })}
          <div className="more-sheet-divider" />
          <button
            type="button"
            className="more-sheet-link"
            onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMoreOpen(false); }}
          >
            {theme === 'dark' ? <MoonIcon className="more-sheet-icon" /> : <SunIcon className="more-sheet-icon" />}
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>
          <button type="button" className="more-sheet-link" onClick={handleSignOut}>
            <SignOutIcon className="more-sheet-icon" />
            Sign out
          </button>
        </BottomSheet>

        {/* No marginLeft here: .shell-body is already a flex row with
            .shell-sidebar as a properly-sized flex item ahead of this div,
            so content starts right where the sidebar ends. An extra
            marginLeft equal to the sidebar width used to double that offset,
            leaving a dead strip of page between the icon rail and the real
            content that belonged to neither — unscrollable, unclickable. */}
        <div className="shell-content">
          {isMobile ? subnavStrip : null}
          {children}
        </div>
      </div>
    </div>
  );
}
