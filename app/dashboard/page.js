'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings, widgetEnabled } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import MobileFab from '../../components/MobileFab';
import ScrollerWithArrows from '../../components/dashboard/ScrollerWithArrows';
import RouteBuilderModal from '../../components/RouteBuilderModal';
import ManualRouteBuilderModal from '../../components/ManualRouteBuilderModal';
import { useCompanyForecast, WeatherRibbon } from '../../components/dashboard/WeatherWidgets';
import NotificationsCard from '../../components/dashboard/NotificationsCard';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage, formattedProjectNumber } from '../../lib/constants';
import { flattenJobFinancials, isChangeOrderAccepted } from '../../lib/jobFinancials';

function fmtMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

// Starting default — no settings UI for this yet, so it's a constant
// until it's clear what value actually fits how margin gets tracked here.
const TARGET_MARGIN_PERCENT = 20;

// One clickable metric — value, label, and (usually) somewhere the
// detail behind the number actually lives. Sized generously: the number
// is the point of a dashboard stat, so it gets to be the biggest thing
// on the line.
function StatTile({ value, label, href, warn, compact }) {
  const body = (
    <div>
      <div style={{ fontSize: compact ? 16 : 19, fontWeight: 700, lineHeight: 1.15, color: warn ? '#a13f3f' : 'var(--heading)' }}>{value}</div>
      <div style={{ fontSize: compact ? 10.5 : 11.5, color: 'var(--ink-soft)', marginTop: 3, lineHeight: 1.25 }}>{label}</div>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} className="stat-tile-link">
      {body}
    </Link>
  );
}

// One labeled group of tiles within the Snapshot section — Cash,
// Pipeline & Backlog, etc. Just a label and a flowing row, not its own
// boxed card, so four groups read as one continuous section instead of
// four separate tiles competing for space. On mobile the tiles scroll
// horizontally (same ScrollerWithArrows pattern as the weather ribbon's
// Hourly view) instead of wrapping into a cramped multi-row grid.
//
// width: '100%' + minWidth: 0 + overflow: hidden are set explicitly at
// every level down to the scroller, rather than trusted to flex
// stretch/inheritance — nested plain <div>s between this and the actual
// flex ancestor don't reliably get a *definite* cross size from stretch
// alone, so without an explicit width here the scroller below ends up
// sized to its unconstrained content instead of the visible viewport.
function StatGroup({ label, tiles, isMobile }) {
  return (
    <div style={isMobile ? { width: '100%', minWidth: 0 } : undefined}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>{label}</div>
      {isMobile ? (
        <div style={{ height: 70, width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
          <ScrollerWithArrows ariaLabel={`${label} stats`} gap={8}>
            {tiles.map(t => (
              <div key={t.label} style={{ flexShrink: 0, width: 106, scrollSnapAlign: 'start' }}>
                <StatTile {...t} compact />
              </div>
            ))}
          </ScrollerWithArrows>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
          {tiles.map(t => <StatTile key={t.label} {...t} />)}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const { settings } = useSettings();
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [manualRouteModalOpen, setManualRouteModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { forecast: companyForecast, loading: weatherLoading, error: weatherError } = useCompanyForecast();

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const load = () => supabase.from('jobs').select('*, job_financials(contract_price, invoice_amount, invoice_status)').then(({ data }) => { if (mounted && data) setJobs(flattenJobFinancials(data)); });
    load();
    const channel = supabase.channel('jobs-stats').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).on('postgres_changes', { event: '*', schema: 'public', table: 'job_financials' }, load).subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  // Total AP — same formula as the Accounts Payable page (work orders not
  // yet paid, plus unpaid business expenses and receipts).
  const [totalAP, setTotalAP] = useState(0);
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const load = () => Promise.all([
      supabase.from('work_orders').select('amount, invoiced_amount').neq('status', 'paid'),
      supabase.from('business_expenses').select('amount').eq('payment_status', 'unpaid'),
      supabase.from('receipts').select('amount').eq('payment_status', 'unpaid'),
    ]).then(([{ data: wo }, { data: be }, { data: r }]) => {
      if (!mounted) return;
      const totalWO = (wo || []).reduce((s, w) => s + Number(w.invoiced_amount ?? w.amount ?? 0), 0);
      const totalBE = (be || []).reduce((s, b) => s + Number(b.amount || 0), 0);
      const totalReceipts = (r || []).reduce((s, x) => s + Number(x.amount || 0), 0);
      setTotalAP(totalWO + totalBE + totalReceipts);
    });
    load();
    const channel = supabase.channel('dash-ap')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_expenses' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts' }, load)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  // Per-job cost + accepted-change-order totals, for the margin stats —
  // same formula JobCostSummary.js uses on a job's own Financials tab,
  // just aggregated across every job instead of one at a time.
  const [costsByJob, setCostsByJob] = useState({});
  const [acceptedCOByJob, setAcceptedCOByJob] = useState({});
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const load = () => Promise.all([
      supabase.from('job_costs').select('job_id, amount, status').in('status', ['committed', 'actual']),
      supabase.from('change_orders').select('job_id, amount, co_signatures'),
    ]).then(([{ data: costs }, { data: cos }]) => {
      if (!mounted) return;
      const costMap = {};
      for (const c of costs || []) costMap[c.job_id] = (costMap[c.job_id] || 0) + Number(c.amount || 0);
      setCostsByJob(costMap);

      const coMap = {};
      for (const co of cos || []) {
        if (!isChangeOrderAccepted(co)) continue;
        coMap[co.job_id] = (coMap[co.job_id] || 0) + Number(co.amount || 0);
      }
      setAcceptedCOByJob(coMap);
    });
    load();
    const channel = supabase.channel('dash-margins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders' }, load)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session]);

  // Weather risk aggregate — a separate endpoint since it involves an
  // external API call and trade-threshold evaluation across every job's
  // schedule, not something to compute client-side.
  const [weatherRisk, setWeatherRisk] = useState({ flaggedCount: 0, flagged: [] });
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    fetch('/api/dashboard/weather-risk')
      .then(res => res.json())
      .then(data => { if (mounted && !data.error) setWeatherRisk(data); })
      .catch(() => {});
    return () => { mounted = false; };
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
      phaseForStage(j.stage) === 'opportunity' &&
      j.stage !== 'lost'
    );

    // Backlog: signed, not-yet-finished contract value — approved/
    // scheduled/active, deliberately excluding 'completed' since that
    // work is physically done even if not yet invoiced.
    const backlogValue = jobs
      .filter(j => ['approved', 'scheduled', 'active'].includes(j.stage))
      .reduce((sum, j) => sum + (parseFloat(j.contract_price) || 0), 0);

    // Pipeline: estimate value sitting in front of a signature — jobs
    // still in the opportunity phase, not yet lost.
    const pipelineValue = jobs
      .filter(j => phaseForStage(j.stage) === 'opportunity' && j.stage !== 'lost')
      .reduce((sum, j) => sum + (parseFloat(j.contract_price) || 0), 0);

    // Win rate: of everything that's been decided one way or the other
    // (won past the opportunity phase, or explicitly lost) — all-time,
    // not a trailing window, since volume here is modest enough that a
    // window would make this noisier, not more useful.
    const lostCount = jobs.filter(j => j.stage === 'lost').length;
    const decidedCount = soldCount + lostCount;
    const winRatePercent = decidedCount > 0 ? (soldCount / decidedCount) * 100 : null;

    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const jobsStartingThisWeek = jobs.filter(j =>
      j.scheduled_start_date &&
      new Date(j.scheduled_start_date) >= now &&
      new Date(j.scheduled_start_date) <= weekFromNow &&
      j.stage !== 'lost'
    );

    // Margin — same formula as JobCostSummary.js's per-job Financials
    // tab: (contract price + accepted change orders − costs) / adjusted
    // contract price. Computed across "sold" jobs (soldCount's
    // definition) that have a contract price to measure against.
    const marginPercents = jobs
      .filter(j => phaseForStage(j.stage) !== 'opportunity' && j.stage !== 'lost' && j.contract_price != null)
      .map(j => {
        const adjustedValue = Number(j.contract_price) + (acceptedCOByJob[j.id] || 0);
        const costs = costsByJob[j.id] || 0;
        return adjustedValue > 0 ? ((adjustedValue - costs) / adjustedValue) * 100 : null;
      })
      .filter(m => m !== null);

    const avgMarginPercent = marginPercents.length > 0
      ? marginPercents.reduce((sum, m) => sum + m, 0) / marginPercents.length
      : null;
    const jobsBelowTargetMarginCount = marginPercents.filter(m => m < TARGET_MARGIN_PERCENT).length;

    return {
      byStage, soldCount, totalPaid, totalAR, revenueYTD, revenueMTD, overdue,
      backlogValue, pipelineValue, winRatePercent, jobsStartingThisWeek,
      avgMarginPercent, jobsBelowTargetMarginCount,
    };
  }, [jobs, costsByJob, acceptedCOByJob]);

  if (loading || !session) return null;

  const show = key => widgetEnabled(settings, key);
  const net = stats.totalAR - totalAP;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Dashboard</h2>
          {!isMobile && <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>}
        </div>

        {isMobile && (
          <MobileFab
            label="New Opportunity"
            items={[{ label: '+ New Opportunity', primary: true, onClick: () => router.push('/jobs/new') }]}
          />
        )}

        <div className="dashboard-layout">
          <div className="dashboard-main">
            {show('weather') && (
              <WeatherRibbon forecast={companyForecast} loading={weatherLoading} error={weatherError} />
            )}

            {(show('cash') || show('pipeline_backlog') || show('profitability') || show('schedule_health')) && (
              <div className="dash-section">
                <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: 18, width: '100%', minWidth: 0 } : { display: 'flex', flexWrap: 'wrap', gap: '20px 48px' }}>
                  {show('cash') && (
                    <StatGroup
                      isMobile={isMobile}
                      label="Cash"
                      tiles={[
                        { label: 'Net cash (AR − AP)', value: `${net < 0 ? '-' : ''}${fmtMoney(Math.abs(net))}`, warn: net < 0 },
                        { label: 'Total AR', value: fmtMoney(stats.totalAR), href: '/financials/receivable' },
                        { label: 'Total AP', value: fmtMoney(totalAP), href: '/financials/payable' },
                        { label: 'Total paid (all-time)', value: fmtMoney(stats.totalPaid), href: '/financials' },
                      ]}
                    />
                  )}
                  {show('pipeline_backlog') && (
                    <StatGroup
                      isMobile={isMobile}
                      label="Pipeline & Backlog"
                      tiles={[
                        { label: 'Backlog value', value: fmtMoney(stats.backlogValue), href: '/jobs' },
                        { label: 'Pipeline value', value: fmtMoney(stats.pipelineValue), href: '/jobs' },
                        { label: 'Win rate', value: stats.winRatePercent == null ? '—' : `${Math.round(stats.winRatePercent)}%`, href: '/jobs' },
                        { label: 'Sold jobs', value: stats.soldCount, href: '/jobs' },
                      ]}
                    />
                  )}
                  {show('profitability') && (
                    <StatGroup
                      isMobile={isMobile}
                      label="Profitability"
                      tiles={[
                        { label: 'Income YTD', value: fmtMoney(stats.revenueYTD), href: '/financials' },
                        { label: 'Income MTD', value: fmtMoney(stats.revenueMTD), href: '/financials' },
                        { label: 'Avg. gross margin', value: stats.avgMarginPercent == null ? '—' : `${Math.round(stats.avgMarginPercent)}%`, href: '/financials' },
                        { label: `Below ${TARGET_MARGIN_PERCENT}% margin`, value: stats.jobsBelowTargetMarginCount, warn: stats.jobsBelowTargetMarginCount > 0, href: '/financials' },
                      ]}
                    />
                  )}
                  {show('schedule_health') && (
                    <StatGroup
                      isMobile={isMobile}
                      label="Schedule"
                      tiles={[
                        { label: 'Starting this week', value: stats.jobsStartingThisWeek.length, href: '/jobs' },
                        { label: 'Weather-flagged phases', value: weatherRisk.flaggedCount, warn: weatherRisk.flaggedCount > 0, href: '/weather-risk' },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}

            {show('job_counts_by_stage') && (
              <div className="dash-section">
                <h3>Job counts by stage</h3>
                {isMobile ? (
                  <div style={{ height: 58, width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                    <ScrollerWithArrows ariaLabel="job stages" gap={6}>
                      {STAGE_ORDER.map(s => (
                        <div key={s} style={{ flexShrink: 0, width: 62, textAlign: 'center', scrollSnapAlign: 'start' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>{stats.byStage[s] || 0}</div>
                          <div style={{ fontSize: 8.5, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3, lineHeight: 1.2 }}>{STAGE_LABELS[s]}</div>
                        </div>
                      ))}
                      <div style={{ flexShrink: 0, width: 62, textAlign: 'center', borderLeft: '1px solid var(--line)', scrollSnapAlign: 'start' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>{jobs.length}</div>
                        <div style={{ fontSize: 8.5, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3 }}>Total</div>
                      </div>
                    </ScrollerWithArrows>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px 28px' }}>
                    {STAGE_ORDER.map(s => (
                      <div key={s} style={{ minWidth: 60 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>{stats.byStage[s] || 0}</div>
                        <div style={{ fontSize: 9, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3 }}>{STAGE_LABELS[s]}</div>
                      </div>
                    ))}
                    <div style={{ minWidth: 60, borderLeft: '1px solid var(--line)', paddingLeft: 20 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>{jobs.length}</div>
                      <div style={{ fontSize: 9, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3 }}>Total</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {show('overdue_opportunities') && (
              <div className="dash-section">
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

            {show('sales_route_ai') && (
              <div className="dash-section" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={() => setRouteModalOpen(true)}>
                  Build my sales route →
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setManualRouteModalOpen(true)}>
                  Create Sales Route →
                </button>
              </div>
            )}
          </div>

          <div className="dashboard-notifications-rail">
            <NotificationsCard />
          </div>
        </div>
      </div>

      <RouteBuilderModal open={routeModalOpen} onClose={() => setRouteModalOpen(false)} />
      <ManualRouteBuilderModal open={manualRouteModalOpen} onClose={() => setManualRouteModalOpen(false)} />
    </AppShell>
  );
}
