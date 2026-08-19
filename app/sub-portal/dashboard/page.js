'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../../../lib/constants';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SubPortalDashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'crew'
  const [workOrders, setWorkOrders] = useState([]);
  const [jobsById, setJobsById] = useState({});

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
  const others = workOrders.filter(wo => !needsSignature.includes(wo));

  return (
    <div style={{ background: '#f4f2e8', minHeight: '100vh' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid var(--line)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{company.company_name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{role === 'admin' ? 'Admin access' : 'Crew access — view only'}</div>
        </div>
        <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
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

        <div className="card">
          <h3>All Work Orders</h3>
          {others.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          {others.map(wo => (
            <WorkOrderRow key={wo.id} wo={wo} job={jobsById[wo.job_id]} role={role} />
          ))}
        </div>
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
