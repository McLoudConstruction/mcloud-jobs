'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { SignOutIcon } from './icons';

// Wide, text-only nav (pnav-* classes) — same shape as SubPortalShell,
// deliberately different from AppShell's own 84px icon rail
// (shell-sidebar-inner/shell-nav-link), which stays untouched.
const NAV_ITEMS = [
  { href: '/customerportal/projects', label: 'Home' },
  { href: '/customerportal/documents', label: 'Documents' },
  { href: '/customerportal/invoices', label: 'Invoices' },
  { href: '/customerportal/inbox', label: 'Inbox' },
];

// First name only — "Welcome, John" reads friendlier in a narrow
// sidebar than the full "John Smith" job records store customer_name as.
function firstNameOf(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0];
}

function IdentityBlock({ customerName }) {
  const firstName = firstNameOf(customerName);
  if (!firstName) return null;
  return (
    <div className="pnav-identity-block">
      <div className="pnav-identity-name">Welcome, {firstName}</div>
    </div>
  );
}

export default function CustomerPortalShell({ customerName, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { settings } = useSettings();
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    setMounted(true);
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/customerportal');
  }

  // Wider than the icon-rail shells (84px) since labels are spelled out
  // in full rather than abbreviated under a small icon.
  const sidebarWidth = isMobile ? 0 : 232;
  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;
  const firstName = firstNameOf(customerName);

  return (
    <div className="shell">
      <div className="shell-topbar">
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 96, width: 'auto' }} />
            : <span className="brand">McLoud <span>Portal</span></span>}
        </div>
      </div>

      {/* The sidebar (and the welcome block inside it) is hidden below
          900px along with the rest of shell-sidebar, so mobile gets its
          own compact strip here instead of losing the greeting. */}
      {isMobile && firstName && (
        <div className="pnav-mobile-identity-strip">
          <span className="pnav-identity-name">Welcome, {firstName}</span>
        </div>
      )}

      <div className="shell-body">
        <div
          className="shell-sidebar"
          style={{ width: mounted ? sidebarWidth : 0 }}
        >
          <div className="pnav-sidebar-inner">
            <div>
              <IdentityBlock customerName={customerName} />
              <div className="pnav-links">
                {NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`pnav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="pnav-bottom">
              <button
                className="pnav-link"
                onClick={handleSignOut}
              >
                <SignOutIcon className="pnav-icon" />
                Sign out
              </button>
            </div>
          </div>
        </div>

        {isMobile && (
          <nav className="pnav-bottomnav">
            {NAV_ITEMS.map(item => (
              <a
                key={item.href}
                href={item.href}
                className={`pnav-bottomnav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
              >
                {item.label}
              </a>
            ))}
            <button className="pnav-bottomnav-link" onClick={handleSignOut}>Sign out</button>
          </nav>
        )}

        {/* No marginLeft here — .shell-body is already a flex row with
            .shell-sidebar sized by its own inline width ahead of this div,
            so content starts right where the sidebar ends. An extra
            marginLeft equal to the sidebar width doubled that offset,
            leaving a dead, unclickable strip of page between the sidebar
            and the real content that belonged to neither. Same fix as
            SubPortalShell's and AppShell's own .shell-content already have. */}
        <div className="shell-content">
          {children}
        </div>
      </div>
    </div>
  );
}
