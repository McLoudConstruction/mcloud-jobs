'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { SignOutIcon } from './icons';

function InboxIcon(props) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 5.5h14a1 1 0 011 1v8a1 1 0 01-1 1H8l-4 3.5v-3.5H3a1 1 0 01-1-1v-8a1 1 0 011-1z" />
      <path d="M6 9h8M6 12h5" />
    </svg>
  );
}
function ProjectsIcon(props) {
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
  { href: '/customerportal/projects', label: 'Projects', icon: ProjectsIcon },
  { href: '/customerportal/invoices', label: 'Invoices', icon: InvoicesIcon },
  { href: '/customerportal/inbox', label: 'Inbox', icon: InboxIcon },
];

export default function CustomerPortalShell({ children }) {
  const { settings } = useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(47);
  const topbarRef = useRef(null);

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
    router.replace('/customerportal');
  }

  function closeOnMobile() { if (isMobile) setNavOpen(false); }

  const sidebarWidth = isMobile ? (navOpen ? 240 : 0) : (navOpen ? 240 : 64);
  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

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
            ? <img src={settings.logo_url} alt="Logo" style={{ height: (logoSize || 32) / 4, width: 'auto' }} />
            : <span className="brand">McLoud <span>Portal</span></span>}
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

        {isMobile && navOpen && <div className="shell-overlay" onClick={() => setNavOpen(false)} />}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0, transition: 'margin-left 0.2s ease' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
