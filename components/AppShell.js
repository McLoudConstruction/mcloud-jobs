'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { DashboardIcon, SalesIcon, JobDashboardIcon, SubcontractorsIcon, FinanceIcon, SettingsIcon, SignOutIcon, PersonIcon, CalculatorIcon, MessagesIcon, InvoiceIcon, SunIcon, MoonIcon } from './icons';
import { useTheme } from '../lib/useTheme';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  {
    href: '/customers',
    label: 'Contacts',
    icon: PersonIcon,
    children: [
      { href: '/properties', label: 'Properties' },
      { href: '/companies', label: 'Companies' },
    ],
  },
  { href: '/sales', label: 'Sales', icon: SalesIcon },
  { href: '/jobs', label: 'Jobs', icon: JobDashboardIcon },
  { href: '/subcontractors', label: 'Subcontractors', icon: SubcontractorsIcon },
  { href: '/messages', label: 'Messages', icon: MessagesIcon },
  { href: '/invoices', label: 'Invoices', icon: InvoiceIcon },
  {
    href: '/financials',
    label: 'Financials',
    icon: FinanceIcon,
    children: [
      { href: '/financials/payable', label: 'Accounts Payable' },
      { href: '/financials/receivable', label: 'Accounts Receivable' },
    ],
  },
  { href: '/estimating', label: 'Estimating', icon: CalculatorIcon },
];

function isSectionActive(item, pathname) {
  if (pathname === item.href) return true;
  if (item.children && item.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) return true;
  return pathname.startsWith(item.href + '/');
}

function getCurrentSection(pathname) {
  return NAV_ITEMS.find(item => item.children && isSectionActive(item, pathname)) || null;
}

export default function AppShell({ children }) {
  const { theme, setTheme } = useTheme();
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(47);
  const [unreadCount, setUnreadCount] = useState(0);
  const topbarRef = useRef(null);

  useEffect(() => {
    let mounted2 = true;
    async function loadUnread() {
      const [{ count: notifCount }, { count: questionCount }] = await Promise.all([
        supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('read', false),
        supabase.from('job_questions').select('*', { count: 'exact', head: true }).is('response', null),
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
    setNavOpen(window.innerWidth >= 900); // open by default on desktop, closed on mobile
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

  function closeOnMobile() { if (isMobile) setNavOpen(false); }

  const sidebarWidth = isMobile ? (navOpen ? 240 : 0) : (navOpen ? 240 : 64);
  const currentSection = getCurrentSection(pathname);

  return (
    <div className="shell">
      <div className="shell-topbar" ref={topbarRef}>
        <div className="shell-header-left">
          <button className="hamburger-btn" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation">
            <span /><span /><span />
          </button>

          <Link href="/notifications" className="hamburger-btn notif-bell" aria-label="Notifications">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8.5c0-3.6-2.7-6.5-6-6.5s-6 2.9-6 6.5c0 5.8-2 7.3-2 7.5a1 1 0 0 0 .9 1.5h14.2a1 1 0 0 0 .9-1.5c0-.2-2-1.7-2-7.5z" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </Link>
        </div>

        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: (logoSize || 32) / 4, width: 'auto' }} />
            : <span className="brand">McLoud <span>Jobs</span></span>}
        </div>
      </div>

      <div className="shell-body">
        <div
          className={`shell-sidebar ${!isMobile && !navOpen ? 'collapsed' : ''}`}
          style={mounted ? {
            width: sidebarWidth,
            transform: isMobile ? (navOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
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
                  onClick={closeOnMobile}
                  title={!isMobile && !navOpen ? item.label : undefined}
                >
                  {item.icon && <item.icon className="shell-nav-icon" />}
                  <span className="shell-nav-label">{item.label}</span>
                </Link>
              ))}
            </div>

            <div>
              {(isMobile || navOpen) && (
                <div className="theme-slider-row">
                  <button
                    className={`theme-slider ${theme === 'dark' ? 'is-dark' : ''}`}
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label="Toggle light/dark mode"
                    type="button"
                  >
                    <SunIcon width={17} height={17} className="theme-slider-sun" />
                    <MoonIcon width={17} height={17} className="theme-slider-moon" />
                    <span className="theme-slider-knob" />
                  </button>
                </div>
              )}
              <Link
                href="/settings"
                className={`shell-nav-link ${pathname === '/settings' || pathname.startsWith('/settings/') ? 'active' : ''}`}
                onClick={closeOnMobile}
                title={!isMobile && !navOpen ? 'Settings' : undefined}
              >
                <SettingsIcon className="shell-nav-icon" />
                <span className="shell-nav-label">Settings</span>
              </Link>
              <button
                className="shell-nav-link signout-link"
                onClick={handleSignOut}
                title={!isMobile && !navOpen ? 'Sign out' : undefined}
              >
                <SignOutIcon className="shell-nav-icon" />
                <span className="shell-nav-label">Sign out</span>
              </button>
            </div>
          </div>
        </div>

        {isMobile && navOpen && <div className="shell-overlay" onClick={() => setNavOpen(false)} />}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0, transition: 'margin-left 0.2s ease' }}>
          {currentSection && (
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
