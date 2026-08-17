'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings, widgetEnabled } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage } from '../../lib/constants';

function fmtMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const { settings } = useSettings();
  const [jobs, setJobs] = useState([]);
  const [unansweredQuestions, setUnansweredQuestions] = useState([]);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const load = () => supabase.from('jobs').select('*').then(({ data }) => { if (mounted && data) setJobs(data); });
    load();
    const channel = supabase.channel('jobs-stats').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const loadQuestions = () => supabase
      .from('job_questions')
      .select('*, jobs(job_number, customer_name)')
      .is('response', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (mounted && data) setUnansweredQuestions(data); });
    loadQuestions();
    const channel = supabase.channel('dashboard-questions').on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, loadQuestions).subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  const stats = useMemo(() => {
    const byStage = {};
    STAGE_ORDER.forEach(s => { byStage[s] = jobs.filter(j => j.stage === s).length; });

    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();

    // "Sold" = the contract has been signed at some point (past the opportunity phase).
    const soldCount = jobs.filter(j => phaseForStage(j.stage) !== 'opportunity').length;

    const paidJobs = jobs.filter(j => j.invoice_status === 'paid' && j.invoice_amount);
    const totalPaid = paidJobs.reduce((sum, j) => sum + (parseFloat(j.invoice_amount) || 0), 0);

    const arJobs = jobs.filter(j => j.invoice_status === 'sent' && j.invoice_amount);
    const totalAR = arJobs.reduce((sum, j) => sum + (parseFloat(j.invoice_amount) || 0), 0);

    const revenueYTD = paidJobs
      .filter(j => j.invoiced_at && new Date(j.invoiced_at).getFullYear() === thisYear)
      .reduce((sum, j) => sum + (parseFloat(j.invoice_amount) || 0), 0);

    const revenueMTD = paidJobs
      .filter(j => j.invoiced_at && new Date(j.invoiced_at).getFullYear() === thisYear && new Date(j.invoiced_at).getMonth() === thisMonth)
      .reduce((sum, j) => sum + (parseFloat(j.invoice_amount) || 0), 0);

    const overdue = jobs.filter(j =>
      j.expected_close_date &&
      new Date(j.expected_close_date) < now &&
      phaseForStage(j.stage) === 'opportunity'
    );

    return { byStage, soldCount, totalPaid, totalAR, revenueYTD, revenueMTD, overdue };
  }, [jobs]);

  if (loading || !session) return null;

  const show = key => widgetEnabled(settings, key);

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Dashboard</h2>
          {show('new_opportunity_button') && (
            <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
          )}
        </div>

        <div className="two-col" style={{ marginBottom: 20 }}>
          {show('sold_job_count') && (
            <div className="card">
              <h3>Sold jobs</h3>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--heading)' }}>{stats.soldCount}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>Contract signed or further along</div>
            </div>
          )}

          {show('job_counts_by_stage') && (
            <div className="card">
              <h3>Job counts by stage</h3>
              {STAGE_ORDER.map(key => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                  <span>{STAGE_LABELS[key]}</span>
                  <span style={{ fontWeight: 700 }}>{stats.byStage[key] || 0}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 14 }}>
                <span>Total jobs</span>
                <span>{jobs.length}</span>
              </div>
            </div>
          )}
        </div>

        <div className="two-col" style={{ marginBottom: 20 }}>
          {show('total_ar') && (
            <div className="card">
              <h3>Total AR (billed, unpaid)</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(stats.totalAR)}</div>
            </div>
          )}
          {show('total_paid') && (
            <div className="card">
              <h3>Total paid</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(stats.totalPaid)}</div>
            </div>
          )}
          {show('revenue_ytd') && (
            <div className="card">
              <h3>Revenue YTD</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(stats.revenueYTD)}</div>
            </div>
          )}
          {show('revenue_mtd') && (
            <div className="card">
              <h3>Revenue MTD</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(stats.revenueMTD)}</div>
            </div>
          )}
          {show('total_profit') && (
            <div className="card">
              <h3>Total profit</h3>
              <div className="empty-state">Needs job cost tracking, coming in a future update.</div>
            </div>
          )}
          {show('sales_route_ai') && (
            <div className="card">
              <h3>Sales route</h3>
              <button className="btn" disabled title="Coming in a future update">Create My Sales Route (AI)</button>
            </div>
          )}
        </div>

        {show('customer_questions') && (
          <div className="card">
            <h3>Customer questions {unansweredQuestions.length > 0 ? `(${unansweredQuestions.length} unanswered)` : ''}</h3>
            {unansweredQuestions.length === 0 && <div className="empty-state">No unanswered questions.</div>}
            {unansweredQuestions.map(q => (
              <Link key={q.id} href={`/jobs/${q.job_id}`} className="job-row">
                <div className="job-main">
                  <span className="job-number">#{q.jobs?.job_number} — {q.jobs?.customer_name}</span>
                  <span className="job-customer" style={{ fontSize: 13, fontWeight: 400 }}>{q.message}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {show('overdue_opportunities') && (
          <div className="card">
            <h3>Overdue opportunities</h3>
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
        )}
      </div>
    </AppShell>
  );
}
