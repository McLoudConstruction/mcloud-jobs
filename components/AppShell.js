'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/customers', label: 'Customer Information' },
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

        <button
          className="btn btn-sm signout-btn"
          onClick={handleSignOut}
          style={{ background: settings.signout_bg, color: settings.signout_text, borderColor: settings.signout_text }}
        >
          Sign out
        </button>
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
          <div style={{ width: 240 }}>
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`shell-nav-link ${pathname === item.href ? 'active' : ''}`}
                onClick={() => { if (isMobile) setNavOpen(false); }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {isMobile && navOpen && <div className="shell-overlay" onClick={() => setNavOpen(false)} />}

        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
