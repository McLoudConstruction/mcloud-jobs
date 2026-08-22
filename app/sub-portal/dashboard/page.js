'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { WORK_ORDER_STATUS_LABELS, formattedProjectNumber } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const TABS = ['Active Projects', 'Scope of Work'];
const ACTIVE_STATUSES = ['draft', 'issued', 'accepted', 'completed'];

export default function SubPortalDashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Active Projects');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, workOrders, jobsById, ready } = useSubPortalData(session);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sub-portal');
  }

  if (loading || !session) return null;
  if (ready && !company) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Subcontractor Portal</h1>
          <p className="sub" style={{ color: '#a13f3f' }}>
            This email isn't linked to a subcontractor account yet. Reach out to McLoud Construction to get set up.
          </p>
          <button className="btn btn-sm" onClick={handleSignOut} style={{ marginTop: 10 }}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!company) return null;

  const needsSignature = role === 'admin' ? workOrders.filter(wo => wo.status === 'issued') : [];

  const activeJobIds = [...new Set(workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).map(wo => wo.job_id))];
  const activeProjects = activeJobIds.map(jobId => ({
    job: jobsById[jobId],
    jobId,
    count: workOrders.filter(wo => wo.job_id === jobId && ACTIVE_STATUSES.includes(wo.status)).length,
  }));

  const scopeByJob = {};
  workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).forEach(wo => {
    const items = Array.isArray(wo.included_scope_items) ? wo.included_scope_items : [];
    if (items.length === 0) return;
    if (!scopeByJob[wo.job_id]) scopeByJob[wo.job_id] = [];
    scopeByJob[wo.job_id].push(...items);
  });

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        {needsSignature.length > 0 && (
          <div className="card">
            <h3>Needs Your Signature</h3>
            {needsSignature.map(wo => (
              <WorkOrderRow key={wo.id} wo={wo} job={jobsById[wo.job_id]} role={role} />
            ))}
          </div>
        )}

        <div className="sub-portal-tabs">
          {TABS.map(t => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Active Projects' && (
          <div className="card">
            <h3>Active Projects</h3>
            {activeProjects.length === 0 && <div className="empty-state">Nothing active right now.</div>}
            {activeProjects.map(({ job, jobId, count }) => (
              <Link key={jobId} href={`/sub-portal/projects/${jobId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job?.project_address || (job ? formattedProjectNumber(job) : 'Job details unavailable')}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{job?.job_type} · Est. completion {fmtDate(job?.expected_close_date)}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{count} work order{count === 1 ? '' : 's'} →</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === 'Scope of Work' && (
          <div className="card">
            <h3>Scope of Work — Active Jobs</h3>
            {Object.keys(scopeByJob).length === 0 && <div className="empty-state">Nothing active right now.</div>}
            {Object.entries(scopeByJob).map(([jobId, items]) => (
              <div key={jobId} style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  {jobsById[jobId]?.project_address || (jobsById[jobId] ? formattedProjectNumber(jobsById[jobId]) : '')}
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {items.map((item, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18, position: 'relative', marginBottom: 4 }}>
                      <span style={{ position: 'absolute', left: 0, color: 'var(--gold)' }}>—</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </SubPortalShell>
  );
}

export function WorkOrderRow({ wo, job, role }) {
  return (
    <Link href={`/sub-portal/work-orders/${wo.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job ? job.project_address || formattedProjectNumber(job) : 'Job details unavailable'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{wo.description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {role === 'admin' && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoneyRow(wo.amount)}</span>}
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
