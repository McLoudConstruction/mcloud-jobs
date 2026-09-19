'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { WORK_ORDER_STATUS_LABELS, FIELD_PROGRESS_LABELS, RFP_RECIPIENT_STATUS_LABELS, subPortalJobHeading } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';
import SubPortalAuthLayout from '../../../components/SubPortalAuthLayout';
import PasswordPromptModal from '../../../components/PasswordPromptModal';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ACTIVE_STATUSES = ['draft', 'issued', 'accepted', 'completed'];

export default function SubPortalDashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    if (!session) return;
    const dismissKey = `mcloud-subportal-password-prompt-dismissed-${session.user.id}`;
    if (window.localStorage.getItem(dismissKey)) return;
    const t = setTimeout(() => setPasswordPromptOpen(true), 400);
    return () => clearTimeout(t);
  }, [session]);

  function dismissPasswordPrompt() {
    setPasswordPromptOpen(false);
    if (session) window.localStorage.setItem(`mcloud-subportal-password-prompt-dismissed-${session.user.id}`, '1');
  }

  const { company, role, workOrders, jobsById, ready } = useSubPortalData(session);

  // Overview pulls a light preview of RFPs and Messages too — the same
  // sources their own full pages read from — so the whole sub portal is
  // visible from one screen without duplicating those pages' full logic.
  const [rfpRecipients, setRfpRecipients] = useState([]);
  const [messages, setMessages] = useState([]);

  const loadRfps = useCallback(async (companyId) => {
    const { data } = await supabase
      .from('sub_visible_rfps')
      .select('*')
      .eq('company_id', companyId)
      .order('sent_at', { ascending: false });
    if (data) setRfpRecipients(data);
  }, []);
  const loadMessages = useCallback(async (companyId) => {
    const { data } = await supabase.from('sub_messages').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    if (data) setMessages(data);
  }, []);

  useEffect(() => {
    if (!company) return;
    loadRfps(company.id);
    loadMessages(company.id);
    const channel = supabase.channel('sub-portal-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `company_id=eq.${company.id}` }, () => loadRfps(company.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_messages', filter: `company_id=eq.${company.id}` }, () => loadMessages(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, loadRfps, loadMessages]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sub-portal');
  }

  if (loading || !session) return null;
  if (ready && !company) {
    return (
      <SubPortalAuthLayout>
        <div className="login-card" style={{ boxShadow: 'none', border: '1px solid var(--panel-line)' }}>
          <h1>Subcontractor Portal</h1>
          <p className="sub" style={{ color: '#a13f3f' }}>
            This email isn't linked to a subcontractor account yet. Reach out to McLoud Construction to get set up.
          </p>
          <button className="btn btn-sm" onClick={handleSignOut} style={{ marginTop: 10 }}>Sign out</button>
        </div>
      </SubPortalAuthLayout>
    );
  }
  if (!company) return null;

  // Upcoming schedule — visible jobs with a future start date, soonest first.
  const upcoming = Object.values(jobsById)
    .filter(j => j.scheduled_start_date && new Date(j.scheduled_start_date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.scheduled_start_date) - new Date(b.scheduled_start_date));

  const activeJobIds = [...new Set(workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).map(wo => wo.job_id))];
  const scopeByJob = {};
  workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).forEach(wo => {
    const items = Array.isArray(wo.included_scope_items) ? wo.included_scope_items : [];
    if (items.length === 0) return;
    if (!scopeByJob[wo.job_id]) scopeByJob[wo.job_id] = [];
    scopeByJob[wo.job_id].push(...items);
  });

  const activeProjects = activeJobIds.map(jobId => ({
    job: jobsById[jobId],
    jobId,
    count: workOrders.filter(wo => wo.job_id === jobId && ACTIVE_STATUSES.includes(wo.status)).length,
    scopeItems: scopeByJob[jobId] || [],
  }));

  // RFP preview — open ones first (needs a proposal), capped short since
  // the full list is one click away on the RFPs page. Work Orders isn't
  // previewed here at all — Active Projects above already surfaces every
  // active work order (via its "N work orders →" row), so a second list
  // of the same work orders was pure duplication. Invoices and Messages
  // are "check when you need to" pages, not ones worth a full preview —
  // they get a single quick-link line each instead, further down.
  const openRfps = rfpRecipients.filter(rr => !rr.responded_at);
  const rfpPreview = [...openRfps, ...rfpRecipients.filter(rr => rr.responded_at)].slice(0, 5);
  const invoiceAwaitingCount = workOrders.filter(wo => wo.status === 'invoiced').length;
  const unreadMessageCount = messages.filter(m => m.sender === 'staff' && !m.read_at).length;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-overview" style={{ paddingTop: 24 }}>
        {/* "Needs Your Attention" now lives in the header bell (every
            page, not just this one) rather than as a section here — see
            SubPortalShell's NotificationBell. */}
        {upcoming.length > 0 && (
          <div className="dash-section" style={{ paddingTop: 0 }}>
            <h3>Upcoming Schedule</h3>
            {upcoming.map(job => (
              <Link key={job.id} href={`/sub-portal/projects/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{subPortalJobHeading(job)}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{job.project_address || job.job_type}</div>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gold)' }}>Starts {fmtDate(job.scheduled_start_date)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Active Projects and the rest run side by side on desktop
            (stacking back to one column under 800px) instead of one long
            single-file column — each grid cell manages its own
            padding/border directly rather than leaning on .dash-section's
            first-child/last-child defaults, since those assume a single
            flowing stack, not a two-column layout. */}
        <div className="overview-grid" style={{ marginTop: upcoming.length > 0 ? 20 : 0 }}>
          <div className="dash-section" style={{ paddingTop: 0, borderBottom: 'none' }}>
            <h3>Active Projects</h3>
            {activeProjects.length === 0 && <div className="empty-state">Nothing active right now.</div>}
            {activeProjects.map(({ job, jobId, count, scopeItems }) => (
              <JobRow key={jobId} job={job} jobId={jobId} count={count} scopeItems={scopeItems} router={router} />
            ))}
          </div>

          <div>
            <OverviewSection title="Requests for Proposal" href="/sub-portal/rfps" empty="Nothing here yet." style={{ paddingTop: 0 }}>
              {rfpPreview.map(rr => (
                <Link key={rr.id} href={`/sub-portal/rfps/${rr.id}`} className="overview-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{rr.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {[subPortalJobHeading(rr), rr.project_address].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className={`badge badge-${rr.status}`}>{RFP_RECIPIENT_STATUS_LABELS[rr.status]}</span>
                </Link>
              ))}
            </OverviewSection>

            {/* Invoices and Messages are "check when you need to" pages,
                not ones that earn a full preview list — one quick-link
                line each, with just enough to say whether anything's
                waiting. */}
            <div className="dash-section" style={{ paddingTop: 20, borderBottom: 'none' }}>
              <div className="overview-quicklinks">
                <Link href="/sub-portal/invoices" className="overview-quicklink">
                  <span>Invoices</span>
                  <span className={`overview-quicklink-detail ${invoiceAwaitingCount > 0 ? 'attn' : ''}`}>
                    {invoiceAwaitingCount > 0 ? `${invoiceAwaitingCount} awaiting payment` : 'Up to date'} →
                  </span>
                </Link>
                <Link href="/sub-portal/messages" className="overview-quicklink">
                  <span>Messages</span>
                  <span className={`overview-quicklink-detail ${unreadMessageCount > 0 ? 'attn' : ''}`}>
                    {unreadMessageCount > 0 ? `${unreadMessageCount} unread` : 'No new messages'} →
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />
    </SubPortalShell>
  );
}

// Shared shape for the preview sections in the right column: a heading
// with a "View all" link out to that category's own full page (kept
// fully intact — this is only a preview), and up to a handful of rows
// the caller supplies, each already wired to its own detail page.
function OverviewSection({ title, href, empty, children, style }) {
  const hasContent = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="dash-section" style={{ paddingTop: 20, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ marginBottom: 0 }}>{title}</h3>
        <Link href={href} style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold)', textDecoration: 'none' }}>View all →</Link>
      </div>
      {!hasContent && <div className="empty-state">{empty}</div>}
      {children}
    </div>
  );
}

// One job, one row: heading is "Lastname — Job #204" (subs know a
// customer by name, not by address), the row opens the full job detail
// page, and Scope of Work nests inside it as an expand/collapse block
// instead of living on its own tab — expanding it is a separate click
// target (stopPropagation) so it doesn't also navigate away.
function JobRow({ job, jobId, count, scopeItems, router }) {
  const [scopeOpen, setScopeOpen] = useState(false);

  function openJob() {
    router.push(`/sub-portal/projects/${jobId}`);
  }
  function toggleScope(e) {
    e.stopPropagation();
    setScopeOpen(v => !v);
  }

  return (
    <div className="subjob-row">
      <div className="subjob-row-main" onClick={openJob} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') openJob(); }}>
        <div className="subjob-row-text">
          <div className="subjob-row-title">{subPortalJobHeading(job)}</div>
          <div className="subjob-row-sub">
            {[job?.project_address, job?.job_type].filter(Boolean).join(' · ')}
            {job?.expected_close_date && ` · Est. completion ${fmtDate(job.expected_close_date)}`}
          </div>
        </div>
        <span className="subjob-row-count">{count} work order{count === 1 ? '' : 's'} →</span>
      </div>

      {scopeItems.length > 0 && (
        <div style={{ paddingBottom: 14 }}>
          <button type="button" className="subjob-scope-toggle" onClick={toggleScope} aria-expanded={scopeOpen}>
            <span className={`subjob-scope-chevron${scopeOpen ? ' open' : ''}`}>›</span>
            Scope of Work ({scopeItems.length})
          </button>
          {scopeOpen && (
            <ul className="subjob-scope-list" style={{ paddingBottom: 0 }}>
              {scopeItems.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkOrderRow({ wo, job, role }) {
  return (
    <Link href={`/sub-portal/work-orders/${wo.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job ? subPortalJobHeading(job) : 'Job details unavailable'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{wo.description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {role === 'admin' && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoneyRow(wo.amount)}</span>}
          {wo.status === 'accepted' && wo.field_progress && wo.field_progress !== 'not_started' && (
            <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{FIELD_PROGRESS_LABELS[wo.field_progress]}</span>
          )}
          <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
        </div>
      </div>
    </Link>
  );
}

function fmtMoneyRow(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
