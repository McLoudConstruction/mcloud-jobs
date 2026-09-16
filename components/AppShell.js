'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { DashboardIcon, SalesIcon, JobDashboardIcon, SubcontractorsIcon, FinanceIcon, SettingsIcon, SignOutIcon, MessagesIcon, SunIcon, MoonIcon, ScheduleIcon } from './icons';
import { useTheme } from '../lib/useTheme';

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
    ],
  },
  { href: '/jobs/calendar', label: 'Schedule', icon: ScheduleIcon },
  {
    href: '/subcontractors',
    label: 'Subcontractors',
    icon: SubcontractorsIcon,
    children: [
      { href: '/subcontractors/work-orders', label: 'Work Orders' },
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

function isSectionActive(item, pathname) {
  if (pathname === item.href) return true;
  if (item.children && item.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) return true;
  return pathname.startsWith(item.href + '/');
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

export default function AppShell({ children }) {
  const { theme, setTheme } = useTheme();
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(47);
  const [unreadCount, setUnreadCount] = useState(0);
  const topbarRef = useRef(null);

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

  useEffect(() => {
    if (!topbarRef.current) return;
    const el = topbarRef.current;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  const sidebarWidth = isMobile ? 0 : 72;
  const currentSection = getCurrentSection(pathname);
  const showSubnav = shouldShowSubnav(currentSection, pathname);

  return (
    <div className="shell">
      <div className="shell-topbar" ref={topbarRef}>
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 32, width: 'auto' }} />
            : <span className="brand">McLoud <span>Jobs</span></span>}
        </div>
      </div>

      <div className="shell-body">
        <div
          className="shell-sidebar"
          style={mounted ? {
            width: sidebarWidth,
            top: headerHeight,
            height: `calc(100dvh - ${headerHeight}px)`,
          } : { width: 0 }}
        >
          <div className="shell-sidebar-inner">
            <div className="shell-nav-links">
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shell-nav-link ${isSectionActive(item, pathname) ? 'active' : ''}`}
                >
                  {item.icon && (
                    <span style={{ position: 'relative', display: 'inline-flex' }}>
                      <item.icon className="shell-nav-icon" />
                      {item.href === '/messages' && unreadCount > 0 && <span className="shell-nav-dot" />}
                    </span>
                  )}
                  <span className="shell-nav-label">{item.label}</span>
                </Link>
              ))}
            </div>

            <div>
              <button
                className="shell-nav-link theme-icon-toggle"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle light/dark mode"
                type="button"
              >
                {theme === 'dark' ? <MoonIcon className="shell-nav-icon" /> : <SunIcon className="shell-nav-icon" />}
                <span className="shell-nav-label">Theme</span>
              </button>
              <Link
                href="/settings"
                className={`shell-nav-link ${pathname === '/settings' || pathname.startsWith('/settings/') ? 'active' : ''}`}
              >
                <SettingsIcon className="shell-nav-icon" />
                <span className="shell-nav-label">Settings</span>
              </Link>
              <button
                className="shell-nav-link signout-link"
                onClick={handleSignOut}
              >
                <SignOutIcon className="shell-nav-icon" />
                <span className="shell-nav-label">Sign out</span>
              </button>
            </div>
          </div>
        </div>

        {isMobile && (
          <nav className="shell-bottomnav">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`shell-bottomnav-link ${isSectionActive(item, pathname) ? 'active' : ''}`}
                aria-label={item.label}
              >
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <item.icon className="shell-bottomnav-icon" />
                  {item.href === '/messages' && unreadCount > 0 && <span className="shell-bottomnav-dot" />}
                </span>
                <span className="shell-bottomnav-label">{item.label}</span>
              </Link>
            ))}
            <Link
              href="/settings"
              className={`shell-bottomnav-link ${pathname === '/settings' || pathname.startsWith('/settings/') ? 'active' : ''}`}
              aria-label="Settings"
            >
              <SettingsIcon className="shell-bottomnav-icon" />
              <span className="shell-bottomnav-label">Settings</span>
            </Link>
          </nav>
        )}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0 }}>
          {showSubnav && (
            <div className="section-subnav">
              <Link href={currentSection.href} className={`stage-tab ${pathname === currentSection.href ? 'active' : ''}`}>Overview</Link>
              {currentSection.children.map(child => (
                <Link key={child.href} href={child.href} className={`stage-tab ${pathname === child.href || pathname.startsWith(child.href + '/') ? 'active' : ''}`}>
                  {child.label}
                </Link>
              ))}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
