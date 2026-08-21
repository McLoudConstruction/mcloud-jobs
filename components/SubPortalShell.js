'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useTheme } from '../lib/useTheme';
import { SunIcon, MoonIcon, SignOutIcon } from './icons';

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

export default function SubPortalShell({ company, role, children }) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
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
          <span className="brand">McLoud <span>Subcontractor</span></span>
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
                    {role === 'admin' ? 'Admin access' : 'Crew access — view only'}
                  </div>
                </div>
              )}
              <div className="shell-nav-links">
                <a
                  href="/sub-portal/dashboard"
                  className="shell-nav-link active"
                  onClick={closeOnMobile}
                  title={!isMobile && !navOpen ? 'Dashboard' : undefined}
                >
                  <DashboardIcon className="shell-nav-icon" />
                  <span className="shell-nav-label">Dashboard</span>
                </a>
              </div>
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
                    <span className="theme-slider-track-icon"><SunIcon width={13} height={13} /></span>
                    <span className="theme-slider-track-icon"><MoonIcon width={13} height={13} /></span>
                    <span className="theme-slider-knob">
                      {theme === 'dark' ? <MoonIcon width={14} height={14} /> : <SunIcon width={14} height={14} />}
                    </span>
                  </button>
                </div>
              )}
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
