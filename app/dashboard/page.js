'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

const STAGE_LABELS = { proposal: 'Proposal', contract: 'Contract', active: 'Active', invoice: 'Invoice', complete: 'Complete' };

function fmtMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const load = () => supabase.from('jobs').select('*').then(({ data }) => { if (mounted && data) setJobs(data); });
    load();
    const channel = supabase.channel('jobs-stats').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  const stats = useMemo(() => {
    const byStage = {};
    Object.keys(STAGE_LABELS).forEach(s => { byStage[s] = jobs.filter(j => j.stage === s).length; });

    const thisYear = new Date().getFullYear();
    const invoicedThisYear = jobs.filter(j =>
      (j.invoice_status === 'sent' || j.invoice_status === 'paid') &&
      j.invoiced_at &&
      new Date(j.invoiced_at).getFullYear() === thisYear
    );
    const totalInvoicedAmount = invoicedThisYear.reduce((sum, j) => sum + (parseFloat(j.invoice_amount) || 0), 0);

    const overdue = jobs.filter(j =>
      j.expected_close_date &&
      new Date(j.expected_close_date) < new Date() &&
      j.stage !== 'complete'
    );

    return { byStage, invoicedCount: invoicedThisYear.length, totalInvoicedAmount, overdue };
  }, [jobs]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Dashboard</h2>

        <div className="two-col" style={{ marginBottom: 20 }}>
          <div className="card">
            <h3>Job counts by stage</h3>
            {Object.entries(STAGE_LABELS).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
                <span>{label}</span>
                <span style={{ fontWeight: 700 }}>{stats.byStage[key] || 0}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 14 }}>
              <span>Total jobs</span>
              <span>{jobs.length}</span>
            </div>
          </div>

          <div className="card">
            <h3>Invoiced this year</h3>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(stats.totalInvoicedAmount)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{stats.invoicedCount} invoiced project{stats.invoicedCount === 1 ? '' : 's'}</div>
          </div>
        </div>

        <div className="card">
          <h3>Overdue expected close dates</h3>
          {stats.overdue.length === 0 && <div className="empty-state">Nothing overdue.</div>}
          {stats.overdue.map(job => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
              <div className="job-main">
                <span className="job-number">#{job.job_number}</span>
                <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
                <span className="job-address">Expected close: {job.expected_close_date}</span>
              </div>
              <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
