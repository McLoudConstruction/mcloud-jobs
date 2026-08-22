'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../../../../lib/constants';
import SubPortalShell from '../../../../components/SubPortalShell';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SubPortalProjectPage() {
  const router = useRouter();
  const { jobId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [company, setCompany] = useState(null);
  const [job, setJob] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const load = useCallback(async (email) => {
    const { data: companyData } = await supabase.from('companies').select('id, company_name, contact_email, crew_email').or(`contact_email.eq.${email},crew_email.eq.${email}`).limit(1).maybeSingle();
    if (!companyData) return;
    setCompany(companyData);
    setRole(companyData.contact_email === email ? 'admin' : 'crew');

    const { data: jobData } = await supabase.from('sub_visible_jobs').select('*').eq('id', jobId).maybeSingle();
    if (jobData) setJob(jobData);

    const { data: woData } = await supabase.from('work_orders').select('*').eq('company_id', companyData.id).eq('job_id', jobId).order('created_at', { ascending: false });
    if (woData) setWorkOrders(woData);
  }, [jobId]);

  useEffect(() => {
    if (!session) return;
    load(session.user.email);
    const channel = supabase.channel(`sub-project-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `job_id=eq.${jobId}` }, () => load(session.user.email)).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, jobId, load]);

  if (loading || !session || !job) return null;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <Link href="/sub-portal/dashboard" className="btn btn-sm">← Back</Link>

        <div className="card">
          <h3>{job.project_address || `Job #${job.job_number}`}</h3>
          <div className="portal-info-grid">
            <div>
              <div className="portal-info-label">Job Type</div>
              <div className="portal-info-value">{job.job_type || '—'}</div>
            </div>
            <div>
              <div className="portal-info-label">Stage</div>
              <div className="portal-info-value">{job.stage || '—'}</div>
            </div>
            <div>
              <div className="portal-info-label">Est. Completion</div>
              <div className="portal-info-value">{fmtDate(job.expected_close_date)}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Work Orders on This Job</h3>
          {workOrders.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          {workOrders.map(wo => (
            <Link key={wo.id} href={`/sub-portal/work-orders/${wo.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{wo.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {role === 'admin' && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(wo.amount)}</span>}
                  <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </SubPortalShell>
  );
}
