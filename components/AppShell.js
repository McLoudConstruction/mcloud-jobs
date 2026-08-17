'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  {
    href: '/sales',
    label: 'Sales Dashboard',
    children: [
      { href: '/customers', label: 'Contacts' },
      { href: '/properties', label: 'Properties' },
      { href: '/companies', label: 'Companies' },
    ],
  },
  { href: '/jobs', label: 'Job Tracker' },
  { href: '/settings', label: 'Settings' },
];

export default function AppShell({ children }) {
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  function closeOnMobile() { if (isMobile) setNavOpen(false); }

  return (
    <div className="shell">
      <div className="shell-topbar">
        <button className="hamburger-btn" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation">
          <span /><span /><span />
        </button>

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
            width: navOpen ? 240 : 0,
            transform: isMobile ? (navOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
            position: isMobile ? 'fixed' : 'sticky',
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

        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
