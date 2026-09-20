'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { SignOutIcon, BellIcon } from './icons';

// Wide, text-only nav (pnav-* classes) — same shape as SubPortalShell,
// deliberately different from AppShell's own 84px icon rail
// (shell-sidebar-inner/shell-nav-link), which stays untouched.
const NAV_ITEMS = [
  { href: '/customerportal/projects', label: 'Home' },
  { href: '/customerportal/schedule', label: 'Schedule' },
  { href: '/customerportal/documents', label: 'Documents' },
  { href: '/customerportal/selections', label: 'Selections' },
  { href: '/customerportal/invoices', label: 'Invoices' },
  { href: '/customerportal/inbox', label: 'Inbox' },
  { href: '/customerportal/notifications', label: 'Notifications' },
];

const NOTIFICATION_CATEGORY_LABELS = {
  message: 'New Message',
  rfp_awarded: 'Awarded',
  payment_failed: 'Payment Issue',
  general: 'Update',
};

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Notification CENTER (persisted history — portal_notifications,
// migration 126) — distinct from any per-page "unread messages" count.
// Self-contained the same way SubPortalShell's own bells are, so every
// page rendering this shell gets it for free.
function CustomerNotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [panelPos, setPanelPos] = useState(null);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const load = useCallback(() => {
    supabase.from('portal_notifications').select('*').eq('recipient_kind', 'customer').eq('dismissed', false)
      .order('created_at', { ascending: false }).limit(8)
      .then(({ data }) => { if (data) setItems(data); });
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('customer-portal-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_notifications' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function toggleOpen() {
    setOpen(o => {
      const next = !o;
      if (next && btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect();
        setPanelPos({ top: rect.bottom + 8, left: rect.left });
      }
      return next;
    });
  }

  async function openItem(item) {
    setOpen(false);
    if (!item.read_at) await supabase.from('portal_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
    router.push(item.link_path || '/customerportal/notifications');
  }

  const unreadCount = items.filter(i => !i.read_at).length;

  return (
    <div className="pnav-bell-wrap" ref={panelRef}>
      <button type="button" className="pnav-bell-btn" ref={btnRef} onClick={toggleOpen} aria-label="Notifications">
        <BellIcon />
        {unreadCount > 0 && <span className="pnav-bell-dot" />}
      </button>

      {open && panelPos && (
        <div className="pnav-bell-panel" style={{ top: panelPos.top, left: panelPos.left }}>
          <div className="pnav-bell-panel-header">Notifications</div>
          {items.length === 0 && <div className="pnav-bell-empty">Nothing yet.</div>}
          {items.map(item => (
            <button key={item.id} type="button" className="pnav-bell-row" onClick={() => openItem(item)} style={{ width: '100%', textAlign: 'left', borderLeft: 0, borderRight: 0, borderBottom: 0, borderRadius: 0, font: 'inherit', background: 'none', cursor: 'pointer' }}>
              <div className="pnav-bell-row-label">
                {!item.read_at && <span className="pnav-bell-dot" style={{ position: 'static', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />}
                {NOTIFICATION_CATEGORY_LABELS[item.category] || 'Update'}
              </div>
              <div className="pnav-bell-row-detail">{item.message} · {timeAgo(item.created_at)}</div>
            </button>
          ))}
          <div className="pnav-bell-divider" />
          <a href="/customerportal/notifications" className="pnav-bell-row" style={{ display: 'block', textAlign: 'center', fontWeight: 600 }} onClick={() => setOpen(false)}>
            View all
          </a>
        </div>
      )}
    </div>
  );
}

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
        <div className="shell-topbar-actions">
          <CustomerNotificationsBell />
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
