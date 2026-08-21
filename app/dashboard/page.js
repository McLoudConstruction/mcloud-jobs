'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings, widgetEnabled } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import RouteBuilderModal from '../../components/RouteBuilderModal';
import FitText from '../../components/FitText';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage, formattedProjectNumber } from '../../lib/constants';

function fmtMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const { settings } = useSettings();
  const [jobs, setJobs] = useState([]);
  const [routeModalOpen, setRouteModalOpen] = useState(false);

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

        <div className="dash-kpi-grid" style={{ marginBottom: 20 }}>
          {show('sold_job_count') && (
            <div className="card">
              <h3>Sold jobs</h3>
              <FitText style={{ color: 'var(--heading)' }}>{stats.soldCount}</FitText>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>Contract signed or further along</div>
            </div>
          )}
          {show('total_ar') && (
            <div className="card">
              <h3>Total AR (billed, unpaid)</h3>
              <FitText style={{ color: 'var(--heading)' }}>{fmtMoney(stats.totalAR)}</FitText>
            </div>
          )}
          {show('total_paid') && (
            <div className="card">
              <h3>Total paid (all-time)</h3>
              <FitText style={{ color: 'var(--heading)' }}>{fmtMoney(stats.totalPaid)}</FitText>
            </div>
          )}
          {show('revenue_ytd') && (
            <div className="card">
              <h3>Income YTD</h3>
              <FitText style={{ color: 'var(--heading)' }}>{fmtMoney(stats.revenueYTD)}</FitText>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>Cash actually collected</div>
            </div>
          )}
          {show('revenue_mtd') && (
            <div className="card">
              <h3>Income MTD</h3>
              <FitText style={{ color: 'var(--heading)' }}>{fmtMoney(stats.revenueMTD)}</FitText>
            </div>
          )}
          {show('total_profit') && (
            <Link href="/financials" className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <h3>Profit &amp; margin</h3>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Full breakdown on the Financial Dashboard →</div>
            </Link>
          )}
          {show('sales_route_ai') && (
            <div className="card sales-route-card" onClick={() => setRouteModalOpen(true)}>
              <h3>Sales route</h3>
              <div className="empty-state" style={{ padding: '8px 0' }}>Click to build a route based on your area, stop count, and property types.</div>
            </div>
          )}
        </div>

        {show('job_counts_by_stage') && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Job counts by stage</h3>
            <div className="dash-stage-strip">
              {STAGE_ORDER.map(key => (
                <div key={key} className="dash-stage-item">
                  <div className="dash-stage-count">{stats.byStage[key] || 0}</div>
                  <div className="dash-stage-label">{STAGE_LABELS[key]}</div>
                </div>
              ))}
              <div className="dash-stage-item dash-stage-total">
                <div className="dash-stage-count">{jobs.length}</div>
                <div className="dash-stage-label">Total jobs</div>
              </div>
            </div>
          </div>
        )}

        {show('overdue_opportunities') && (
          <div className="card">
            <h3>Overdue opportunities</h3>
            {stats.overdue.length === 0 && <div className="empty-state">Nothing overdue.</div>}
            {stats.overdue.map(job => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
                <div className="job-main">
                  <span className="job-number">{formattedProjectNumber(job)}</span>
                  <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
                  <span className="job-address">Expected close: {job.expected_close_date}</span>
                </div>
                <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <RouteBuilderModal open={routeModalOpen} onClose={() => setRouteModalOpen(false)} />
    </AppShell>
  );
}
