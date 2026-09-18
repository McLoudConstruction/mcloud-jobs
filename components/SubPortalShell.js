'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { SignOutIcon } from './icons';

// Sub-portal-only nav: wide sidebar, spelled-out labels, no icons — this
// is deliberately a different shape than AppShell/CustomerPortalShell's
// narrow icon rail, so it lives in its own class names (sp-*) rather than
// reusing shell-sidebar-inner/shell-nav-link, which stay untouched for
// the GC and customer portals.
const NAV_ITEMS = [
  { href: '/sub-portal/dashboard', label: 'Dashboard' },
  { href: '/sub-portal/rfps', label: 'Requests for Proposal' },
  { href: '/sub-portal/work-orders', label: 'Work Orders' },
  { href: '/sub-portal/invoices', label: 'Invoices' },
  { href: '/sub-portal/messages', label: 'Messages' },
  { href: '/sub-portal/settings', label: 'Settings' },
];

function CompanyBlock({ company, role }) {
  if (!company) return null;
  return (
    <div className="sp-company-block">
      <div className="sp-company-name">{company.company_name}</div>
      <div className="sp-company-role">{role === 'admin' ? 'Owner/Manager access' : 'Crew access — view only'}</div>
    </div>
  );
}

export default function SubPortalShell({ company, role, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { settings } = useSettings();
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const logoSize = isMobile ? settings.logo_size_mobile : settings.logo_size_desktop;

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    setMounted(true);
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  // Unread badge on the Messages nav item — self-contained here so every
  // page that renders this shell gets it for free, no per-page plumbing.
  useEffect(() => {
    if (!company?.id) return;
    let active = true;
    function loadUnread() {
      supabase.from('sub_messages').select('*', { count: 'exact', head: true })
        .eq('company_id', company.id).eq('sender', 'staff').is('read_at', null)
        .then(({ count }) => { if (active) setUnreadMessages(count || 0); });
    }
    loadUnread();
    const channel = supabase.channel(`sub-portal-unread-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_messages', filter: `company_id=eq.${company.id}` }, loadUnread)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [company?.id]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sub-portal');
  }

  // Wider than the icon-rail shells (84px) since labels are spelled out
  // in full rather than abbreviated under a small icon.
  const sidebarWidth = isMobile ? 0 : 232;

  return (
    <div className="shell">
      <div className="shell-topbar">
        {/* No shell-header-left block here — with nothing else in the
            topbar, the flex-start layout puts the logo at the far left
            on its own. Company identity now lives in the sidebar. */}
        <div className="shell-logo">
          {settings.logo_url
            ? <img src={settings.logo_url} alt="Logo" style={{ height: logoSize || 96, width: 'auto' }} />
            : <span className="brand">McLoud <span>Subcontractor</span></span>}
        </div>
      </div>

      {/* The sidebar (and the company block inside it) is hidden below
          900px along with the rest of shell-sidebar, so mobile gets its
          own compact strip here instead of losing company context. */}
      {isMobile && company && (
        <div className="sp-mobile-company-strip">
          <span className="sp-company-name">{company.company_name}</span>
          <span className="sp-company-role">{role === 'admin' ? 'Owner/Manager' : 'Crew — view only'}</span>
        </div>
      )}

      <div className="shell-body">
        <div
          className="shell-sidebar"
          style={{ width: mounted ? sidebarWidth : 0 }}
        >
          <div className="sp-sidebar-inner">
            <div>
              <CompanyBlock company={company} role={role} />
              <div className="sp-nav-links">
                {NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`sp-nav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                  >
                    {item.label}
                    {item.href === '/sub-portal/messages' && unreadMessages > 0 && (
                      <span className="sp-nav-badge">{unreadMessages}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>

            <div className="sp-nav-bottom">
              <button
                className="sp-nav-link sp-signout-link"
                onClick={handleSignOut}
              >
                <SignOutIcon className="sp-nav-icon" />
                Sign out
              </button>
            </div>
          </div>
        </div>

        {isMobile && (
          <nav className="sp-bottomnav">
            {NAV_ITEMS.map(item => (
              <a
                key={item.href}
                href={item.href}
                className={`sp-bottomnav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
              >
                {item.label}
                {item.href === '/sub-portal/messages' && unreadMessages > 0 && (
                  <span className="sp-nav-badge">{unreadMessages}</span>
                )}
              </a>
            ))}
            <button className="sp-bottomnav-link" onClick={handleSignOut}>Sign out</button>
          </nav>
        )}

        <div className="shell-content" style={{ marginLeft: mounted && !isMobile ? sidebarWidth : 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
