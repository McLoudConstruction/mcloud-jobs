'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { formattedProjectNumber } from '../lib/constants';
import { SignOutIcon, BellIcon } from './icons';

// Wide, text-only nav (pnav-* classes) — shared shape with
// CustomerPortalShell, deliberately different from AppShell's own 84px
// icon rail (shell-sidebar-inner/shell-nav-link), which stays untouched.
const NAV_ITEMS = [
  { href: '/sub-portal/dashboard', label: 'Overview' },
  { href: '/sub-portal/rfps', label: 'Requests for Proposal' },
  { href: '/sub-portal/work-orders', label: 'Work Orders' },
  { href: '/sub-portal/calendar', label: 'Calendar' },
  { href: '/sub-portal/invoices', label: 'Invoices' },
  { href: '/sub-portal/messages', label: 'Messages' },
  { href: '/sub-portal/settings', label: 'Settings' },
];

// isMobile gates the bell here rather than relying on the sidebar's own
// CSS display:none below 900px — that only hides it visually, and this
// component (and the fetch/realtime-subscribe effects inside its bell)
// stays mounted underneath. Skipping it outright avoids running the
// same attention query and channel subscription twice at once, since
// the mobile identity strip renders its own bell in parallel.
function IdentityBlock({ company, role, isMobile }) {
  if (!company) return null;
  return (
    <div className="pnav-identity-block">
      <div className="pnav-identity-row">
        <div>
          <div className="pnav-identity-name">{company.company_name}</div>
          <div className="pnav-identity-sub">{role === 'admin' ? 'Owner/Manager access' : 'Crew access — view only'}</div>
        </div>
        {!isMobile && <NotificationBell company={company} role={role} align="left" />}
      </div>
    </div>
  );
}

// Certificate of Insurance is the one compliance item that can quietly
// block a company from being put on new work, so it gets its own banner
// across the top of every page — not just a bell badge someone has to
// think to click. Stays up (no dismiss) for as long as the condition is
// true; it clears itself the moment a current COI is on file.
function ComplianceBanner({ company, role }) {
  if (!company || role !== 'admin') return null;
  const coiDays = company.coi_expires_at ? Math.floor((new Date(company.coi_expires_at) - new Date()) / 86400000) : null;
  if (company.coi_expires_at && coiDays >= 30) return null;

  const expired = !company.coi_expires_at || coiDays < 0;
  const message = !company.coi_expires_at
    ? 'No Certificate of Insurance on file.'
    : coiDays < 0
      ? 'Your Certificate of Insurance has expired.'
      : `Your Certificate of Insurance expires in ${coiDays} day${coiDays === 1 ? '' : 's'}.`;

  return (
    <a href="/sub-portal/settings" className={`pnav-coi-banner ${expired ? 'urgent' : ''}`}>
      {message} Upload a current one to keep working with McLoud Construction. →
    </a>
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

      {/* The sidebar (and the identity block inside it, including the
          notification bell) is hidden below 900px along with the rest of
          shell-sidebar, so mobile gets its own compact strip here instead
          of losing company context — and its own copy of the bell, since
          that's otherwise only reachable from the desktop sidebar now. */}
      {isMobile && company && (
        <div className="pnav-mobile-identity-strip">
          <div>
            <span className="pnav-identity-name">{company.company_name}</span>
            <span className="pnav-identity-sub">{role === 'admin' ? 'Owner/Manager' : 'Crew — view only'}</span>
          </div>
          <NotificationBell company={company} role={role} align="right" />
        </div>
      )}

      <ComplianceBanner company={company} role={role} />

      <div className="shell-body">
        <div
          className="shell-sidebar"
          style={{ width: mounted ? sidebarWidth : 0 }}
        >
          <div className="pnav-sidebar-inner">
            <div>
              <IdentityBlock company={company} role={role} isMobile={isMobile} />
              <div className="pnav-links">
                {NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`pnav-link ${pathname?.startsWith(item.href) ? 'active' : ''}`}
                  >
                    {item.label}
                    {item.href === '/sub-portal/messages' && unreadMessages > 0 && (
                      <span className="pnav-badge">{unreadMessages}</span>
                    )}
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
                {item.href === '/sub-portal/messages' && unreadMessages > 0 && (
                  <span className="pnav-badge">{unreadMessages}</span>
                )}
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
            AppShell's own .shell-content already has. */}
        <div className="shell-content">
          {children}
        </div>
      </div>
    </div>
  );
}

function fmtProjectLabel(job) {
  if (!job) return '';
  return formattedProjectNumber(job);
}

// Mirrors the staff header's bell (AppShell) in look and placement, but
// opens an actual dropdown here rather than just linking out — there's no
// single "everything that needs attention" destination page in the Sub
// Portal the way /messages is on the staff side, so the panel itself is
// the destination. Compliance/COI items are kept visually distinct (their
// own red-tinted row, separated by a divider) from the plain "don't
// forget about this" reminders, per the redesign brief.
function NotificationBell({ company, role, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [needsSignature, setNeedsSignature] = useState([]);
  const [needsProposal, setNeedsProposal] = useState([]);
  const [needsInvoice, setNeedsInvoice] = useState([]);
  const [panelPos, setPanelPos] = useState(null);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  // The panel now lives in the sidebar, which scrolls (overflow-y: auto)
  // and therefore clips overflow-x too — a plain position:absolute panel
  // got cut off at the sidebar's right edge instead of floating over the
  // page like it used to in the topbar. Fixed positioning, computed from
  // the button's actual on-screen location when it opens, escapes that
  // clipping entirely (fixed elements aren't contained by an ancestor's
  // overflow unless that ancestor has a transform, which the sidebar
  // doesn't).
  function toggleOpen() {
    setOpen(o => {
      const next = !o;
      if (next && btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect();
        setPanelPos(
          align === 'left'
            ? { top: rect.bottom + 8, left: rect.left }
            : { top: rect.bottom + 8, right: window.innerWidth - rect.right }
        );
      }
      return next;
    });
  }

  const loadAttention = useCallback(async (companyId) => {
    const [{ data: woData }, { data: rfpData }] = await Promise.all([
      supabase.from('work_orders').select('*, jobs(job_number, estimate_number, stage, project_address)').eq('company_id', companyId),
      supabase.from('rfp_recipients')
        .select('*, rfps(id, title, job_id, jobs(job_number, estimate_number, stage, project_address))')
        .eq('company_id', companyId).in('status', ['sent', 'viewed']),
    ]);
    const wo = woData || [];
    setNeedsSignature(wo.filter(w => w.status === 'issued'));
    setNeedsInvoice(wo.filter(w => ['accepted', 'completed'].includes(w.status) && !w.sub_invoice_filename));
    setNeedsProposal((rfpData || []).filter(rr => !rr.responded_at));
  }, []);

  useEffect(() => {
    // Admin-only, same split as the actions themselves (accept/decline,
    // submit proposal, upload invoice are all admin-only; crew logins
    // are view-only across the board).
    if (!company?.id || role !== 'admin') {
      setNeedsSignature([]); setNeedsProposal([]); setNeedsInvoice([]);
      return;
    }
    loadAttention(company.id);
    const channel = supabase.channel(`sub-portal-attention-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `company_id=eq.${company.id}` }, () => loadAttention(company.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `company_id=eq.${company.id}` }, () => loadAttention(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company?.id, role, loadAttention]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!company) return null;

  const coiDays = company.coi_expires_at ? Math.floor((new Date(company.coi_expires_at) - new Date()) / 86400000) : null;
  const complianceAlert = role === 'admin' && (!company.coi_expires_at || coiDays < 30);
  const attentionCount = needsSignature.length + needsProposal.length + needsInvoice.length + (complianceAlert ? 1 : 0);

  return (
    <div className="pnav-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="pnav-bell-btn"
        ref={btnRef}
        onClick={toggleOpen}
        aria-label="Needs your attention"
      >
        <BellIcon />
        {attentionCount > 0 && <span className="pnav-bell-dot" />}
      </button>

      {open && panelPos && (
        <div className="pnav-bell-panel" style={{ top: panelPos.top, left: panelPos.left, right: panelPos.right }}>
          <div className="pnav-bell-panel-header">Needs Your Attention</div>

          {attentionCount === 0 && (
            <div className="pnav-bell-empty">Nothing waiting on you right now.</div>
          )}

          {complianceAlert && (
            <a href="/sub-portal/settings" className="pnav-bell-row pnav-bell-row-compliance" onClick={() => setOpen(false)}>
              <div className="pnav-bell-row-label">
                {!company.coi_expires_at ? 'Upload your Certificate of Insurance' : coiDays < 0 ? 'Your Certificate of Insurance has expired' : 'Your Certificate of Insurance expires soon'}
              </div>
              <div className="pnav-bell-row-detail">Keep this current so there's no gap before a new job starts.</div>
            </a>
          )}

          {(needsSignature.length > 0 || needsProposal.length > 0 || needsInvoice.length > 0) && (
            <>
              {complianceAlert && <div className="pnav-bell-divider" />}
              {needsSignature.map(wo => (
                <a key={`sig-${wo.id}`} href={`/sub-portal/work-orders/${wo.id}`} className="pnav-bell-row" onClick={() => setOpen(false)}>
                  <div className="pnav-bell-row-label">Sign work order — {wo.jobs?.project_address || fmtProjectLabel(wo.jobs)}</div>
                  {wo.description && <div className="pnav-bell-row-detail">{wo.description}</div>}
                </a>
              ))}
              {needsProposal.map(rr => (
                <a key={`rfp-${rr.id}`} href={`/sub-portal/rfps/${rr.id}`} className="pnav-bell-row" onClick={() => setOpen(false)}>
                  <div className="pnav-bell-row-label">Respond to request for proposal — {rr.rfps?.title || ''}</div>
                  {(rr.rfps?.jobs?.project_address || rr.rfps?.jobs) && (
                    <div className="pnav-bell-row-detail">{rr.rfps.jobs.project_address || fmtProjectLabel(rr.rfps.jobs)}</div>
                  )}
                </a>
              ))}
              {needsInvoice.map(wo => (
                <a key={`inv-${wo.id}`} href={`/sub-portal/work-orders/${wo.id}`} className="pnav-bell-row" onClick={() => setOpen(false)}>
                  <div className="pnav-bell-row-label">Upload invoice — {wo.jobs?.project_address || fmtProjectLabel(wo.jobs)}</div>
                  {wo.description && <div className="pnav-bell-row-detail">{wo.description}</div>}
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
