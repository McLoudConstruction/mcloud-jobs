'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../../../lib/constants';
import { useTheme } from '../../../lib/useTheme';
import { SunIcon, MoonIcon } from '../../../components/icons';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const TABS = ['Active Projects', 'Work Orders', 'Invoices', 'Scope of Work'];
const ACTIVE_STATUSES = ['draft', 'issued', 'accepted', 'completed'];

export default function SubPortalDashboard() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'crew'
  const [workOrders, setWorkOrders] = useState([]);
  const [jobsById, setJobsById] = useState({});
  const [tab, setTab] = useState('Active Projects');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const loadAll = useCallback(async (email) => {
    const { data: companyData } = await supabase
      .from('companies')
      .select('*')
      .or(`contact_email.eq.${email},crew_email.eq.${email}`)
      .limit(1)
      .maybeSingle();
    if (!companyData) return;
    setCompany(companyData);
    setRole(companyData.contact_email === email ? 'admin' : 'crew');

    const { data: woData } = await supabase.from('work_orders').select('*').eq('company_id', companyData.id).order('created_at', { ascending: false });
    if (woData) setWorkOrders(woData);

    const { data: jobData } = await supabase.from('sub_visible_jobs').select('*');
    if (jobData) setJobsById(Object.fromEntries(jobData.map(j => [j.id, j])));

    supabase.rpc('mark_sub_portal_viewed', { target_company_id: companyData.id }).then(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    const email = session.user.email;
    loadAll(email);
    const channel = supabase.channel('sub-portal').on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => loadAll(email)).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/sub-portal');
  }

  if (loading || !session) return null;
  if (session && !company) {
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

  const needsSignature = role === 'admin' ? workOrders.filter(wo => wo.status === 'issued') : [];

  // Active projects = distinct jobs with at least one non-final work order.
  const activeJobIds = [...new Set(workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).map(wo => wo.job_id))];
  const activeProjects = activeJobIds.map(jobId => ({
    job: jobsById[jobId],
    jobId,
    count: workOrders.filter(wo => wo.job_id === jobId && ACTIVE_STATUSES.includes(wo.status)).length,
  }));

  const invoiceWorkOrders = workOrders.filter(wo => ['invoiced', 'paid'].includes(wo.status));

  const scopeByJob = {};
  workOrders.filter(wo => ACTIVE_STATUSES.includes(wo.status)).forEach(wo => {
    const items = Array.isArray(wo.included_scope_items) ? wo.included_scope_items : [];
    if (items.length === 0) return;
    if (!scopeByJob[wo.job_id]) scopeByJob[wo.job_id] = [];
    scopeByJob[wo.job_id].push(...items);
  });

  return (
    <div className="portal-textured" style={{ minHeight: '100vh' }}>
      <div style={{ background: 'var(--header-bg)', borderBottom: '1px solid var(--header-line)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--header-text)' }}>{company.company_name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{role === 'admin' ? 'Admin access' : 'Crew access — view only'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle light/dark mode"
          >
            {theme === 'dark' ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
          </button>
          <button className="btn btn-sm" style={{ color: 'var(--header-text)', borderColor: 'var(--header-line)' }} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24 }}>
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
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job?.project_address || (job ? `Job #${job.job_number}` : 'Job details unavailable')}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{job?.job_type} · Est. completion {fmtDate(job?.expected_close_date)}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{count} work order{count === 1 ? '' : 's'} →</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === 'Work Orders' && (
          <div className="card">
            <h3>All Work Orders</h3>
            {workOrders.length === 0 && <div className="empty-state">Nothing here yet.</div>}
            {workOrders.map(wo => (
              <WorkOrderRow key={wo.id} wo={wo} job={jobsById[wo.job_id]} role={role} />
            ))}
          </div>
        )}

        {tab === 'Invoices' && (
          <div className="card">
            <h3>Invoices</h3>
            {invoiceWorkOrders.length === 0 && <div className="empty-state">Nothing invoiced yet.</div>}
            {invoiceWorkOrders.map(wo => (
              <WorkOrderRow key={wo.id} wo={wo} job={jobsById[wo.job_id]} role={role} />
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
                  {jobsById[jobId]?.project_address || `Job #${jobsById[jobId]?.job_number || ''}`}
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
    </div>
  );
}

function WorkOrderRow({ wo, job, role }) {
  return (
    <Link href={`/sub-portal/work-orders/${wo.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job ? job.project_address || `Job #${job.job_number}` : 'Job details unavailable'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{wo.description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {role === 'admin' && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(wo.amount)}</span>}
          <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
        </div>
      </div>
    </Link>
  );
}

