'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { WORK_ORDER_STATUS_LABELS, FIELD_PROGRESS_LABELS, subPortalJobHeading } from '../../../lib/constants';
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

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
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

        <div className="dash-section" style={{ paddingTop: upcoming.length > 0 ? 20 : 0 }}>
          <h3>Active Projects</h3>
          {activeProjects.length === 0 && <div className="empty-state">Nothing active right now.</div>}
          {activeProjects.map(({ job, jobId, count, scopeItems }) => (
            <JobRow key={jobId} job={job} jobId={jobId} count={count} scopeItems={scopeItems} router={router} />
          ))}
        </div>
      </div>
      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />
    </SubPortalShell>
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
