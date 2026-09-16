'use client';
import { useState, useEffect } from 'react';
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
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    setMounted(true);
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sub-portal');
  }

  const sidebarWidth = isMobile ? 0 : 84;

  return (
    <div className="shell">
      <div className="shell-topbar">
        {company && (
          <div className="shell-header-left">
            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--header-text)' }}>{company.company_name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
              {role === 'admin' ? 'Owner/Manager access' : 'Crew access — view only'}
            </div>
          </div>
        )}
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 96, width: 'auto' }} />
            : <span className="brand">McLoud <span>Subcontractor</span></span>}
        </div>
      </div>

      <div className="shell-body">
        <div
          className="shell-sidebar"
          style={{ width: mounted ? sidebarWidth : 0 }}
        >
          <div className="shell-sidebar-inner">
            <div className="shell-nav-links">
              {NAV_ITEMS.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`shell-nav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                >
                  <item.icon className="shell-nav-icon" />
                  <span className="shell-nav-label">{item.label}</span>
                </a>
              ))}
            </div>

            <button
              className="shell-nav-link signout-link"
              onClick={handleSignOut}
            >
              <SignOutIcon className="shell-nav-icon" />
              <span className="shell-nav-label">Sign out</span>
            </button>
          </div>
        </div>

        {isMobile && (
          <nav className="shell-bottomnav">
            {NAV_ITEMS.map(item => (
              <a
                key={item.href}
                href={item.href}
                className={`shell-bottomnav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                aria-label={item.label}
              >
                <item.icon className="shell-bottomnav-icon" />
                <span className="shell-bottomnav-label">{item.label}</span>
              </a>
            ))}
            <button className="shell-bottomnav-link" onClick={handleSignOut} aria-label="Sign out">
              <SignOutIcon className="shell-bottomnav-icon" />
              <span className="shell-bottomnav-label">Sign out</span>
            </button>
          </nav>
        )}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
