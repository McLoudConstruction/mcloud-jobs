'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { DashboardIcon, SalesIcon, JobDashboardIcon, SubcontractorsIcon, FinanceIcon, SettingsIcon } from './icons';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  {
    href: '/sales',
    label: 'Sales Dashboard',
    icon: SalesIcon,
    children: [
      { href: '/customers', label: 'Contacts' },
      { href: '/properties', label: 'Properties' },
      { href: '/companies', label: 'Companies' },
    ],
  },
  { href: '/jobs', label: 'Job Dashboard', icon: JobDashboardIcon },
  { href: '/subcontractors', label: 'Subcontractors', icon: SubcontractorsIcon },
  {
    href: '/financials',
    label: 'Financial Dashboard',
    icon: FinanceIcon,
    children: [
      { href: '/financials/payable', label: 'Accounts Payable' },
      { href: '/financials/receivable', label: 'Accounts Receivable' },
    ],
  },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function AppShell({ children }) {
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

  const sidebarWidth = navOpen ? 240 : 0;

  return (
    <div className="shell">
      <div className="shell-topbar" ref={topbarRef}>
        <div className="shell-header-left">
          <button className="hamburger-btn" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation">
            <span /><span /><span />
          </button>

          <Link href="/notifications" className="hamburger-btn notif-bell" aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
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
          className="shell-sidebar"
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
                <div key={item.href}>
                  <Link
                    href={item.href}
                    className={`shell-nav-link ${pathname === item.href ? 'active' : ''}`}
                    onClick={closeOnMobile}
                  >
                    {item.icon && <item.icon className="shell-nav-icon" />}
                    {item.label}
                  </Link>
                  {item.children && (
                    <div className="shell-nav-children">
                      {item.children.map(child => (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`shell-nav-link shell-nav-child ${pathname === child.href ? 'active' : ''}`}
                          onClick={closeOnMobile}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              className="btn btn-sm signout-btn"
              onClick={handleSignOut}
              style={{ background: settings.signout_bg, color: settings.signout_text, borderColor: settings.signout_text }}
            >
              Sign out
            </button>
          </div>
        </div>

        {isMobile && navOpen && <div className="shell-overlay" onClick={() => setNavOpen(false)} />}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0, transition: 'margin-left 0.2s ease' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
