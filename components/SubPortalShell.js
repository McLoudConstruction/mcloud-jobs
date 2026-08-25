'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { SignOutIcon, SettingsIcon } from './icons';

function DashboardIcon(props) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.2" />
      <rect x="11" y="11" width="6.5" height="6.5" rx="1.2" />
    </svg>
  );
}
function WorkOrdersIcon(props) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 3.5h8l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1z" />
      <path d="M12 3.5v4h4M7 10.5h6M7 13.5h6" />
    </svg>
  );
}
function InvoicesIcon(props) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5.5 2.5h9v15l-2.2-1.5-2.3 1.5-2.3-1.5-2.2 1.5v-15z" />
      <path d="M7.7 6.2h4.6M7.7 9h4.6M7.7 11.8h3" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: '/sub-portal/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { href: '/sub-portal/work-orders', label: 'Work Orders', icon: WorkOrdersIcon },
  { href: '/sub-portal/invoices', label: 'Invoices', icon: InvoicesIcon },
  { href: '/sub-portal/settings', label: 'Settings', icon: SettingsIcon },
];

export default function SubPortalShell({ company, role, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { settings } = useSettings();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(47);
  const topbarRef = useRef(null);
  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    setNavOpen(window.innerWidth >= 900);
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
    router.replace('/sub-portal');
  }

  function closeOnMobile() { if (isMobile) setNavOpen(false); }

  const sidebarWidth = isMobile ? (navOpen ? 240 : 0) : (navOpen ? 240 : 64);

  return (
    <div className="shell">
      <div className="shell-topbar" ref={topbarRef}>
        <div className="shell-header-left">
          <button className="hamburger-btn" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation">
            <span /><span /><span />
          </button>
        </div>
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 32, width: 'auto' }} />
            : <span className="brand">McLoud <span>Subcontractor</span></span>}
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
            <div>
              {(isMobile || navOpen) && company && (
                <div style={{ padding: '10px 24px 16px', borderBottom: '1px solid var(--panel-line)', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--heading)' }}>{company.company_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                    {role === 'admin' ? 'Owner/Manager access' : 'Crew access — view only'}
                  </div>
                </div>
              )}
              <div className="shell-nav-links">
                {NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`shell-nav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                    onClick={closeOnMobile}
                    title={!isMobile && !navOpen ? item.label : undefined}
                  >
                    <item.icon className="shell-nav-icon" />
                    <span className="shell-nav-label">{item.label}</span>
                  </a>
                ))}
              </div>
            </div>

            <div>
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
          {children}
        </div>
      </div>
    </div>
  );
}
