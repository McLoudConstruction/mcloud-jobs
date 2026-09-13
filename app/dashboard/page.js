'use client';
import { useEffect, useMemo, useState, cloneElement } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings, widgetEnabled } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import RouteBuilderModal from '../../components/RouteBuilderModal';
import { useCompanyForecast, WeatherCard } from '../../components/dashboard/WeatherWidgets';
import { resolveWidgetOrder } from '../../lib/dashboardWidgets';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage, formattedProjectNumber } from '../../lib/constants';
import { flattenJobFinancials, isChangeOrderAccepted } from '../../lib/jobFinancials';

function fmtMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

// Starting default — no settings UI for this yet, so it's a constant
// until it's clear what value actually fits how margin gets tracked here.
const TARGET_MARGIN_PERCENT = 20;

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const { settings } = useSettings();
  const [jobs, setJobs] = useState([]);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const { forecast: companyForecast, loading: weatherLoading, error: weatherError } = useCompanyForecast();

  // Widget order is company-wide (one shared app_settings row, same as
  // every other dashboard setting) — dragging here changes it for
  // everyone, the same as reordering it in Settings → Dashboard would.
  // localOrder is an optimistic override so a drop feels instant instead
  // of waiting on the round trip; the realtime subscription inside
  // useSettings brings `settings` in sync shortly after, at which point
  // this resets to null and defers back to it.
  const [localOrder, setLocalOrder] = useState(null);
  const [dragState, setDragState] = useState({ draggingIndex: null, dragOverIndex: null });

  useEffect(() => { setLocalOrder(null); }, [settings.dashboard_widget_order]);

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

  // Per-job cost + accepted-change-order totals, for the margin widgets —
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

  // One render function per positioned widget, looked up by key so the
  // grid below can iterate in whatever order Settings → Dashboard has
  // saved (see lib/dashboardWidgets.js) instead of a fixed layout order.
  function renderWidget(key) {
    switch (key) {
      case 'weather':
        return <WeatherCard key={key} forecast={companyForecast} loading={weatherLoading} error={weatherError} />;
      case 'key_metrics': {
        const net = stats.totalAR - totalAP;
        const sections = [
          {
            label: 'Cash',
            items: [
              { label: 'Net cash (AR − AP)', value: `${net < 0 ? '-' : ''}${fmtMoney(Math.abs(net))}`, warn: net < 0 },
              { label: 'Total AR', value: fmtMoney(stats.totalAR) },
              { label: 'Total AP', value: fmtMoney(totalAP), href: '/financials/payable' },
              { label: 'Total paid (all-time)', value: fmtMoney(stats.totalPaid) },
            ],
          },
          {
            label: 'Pipeline & Backlog',
            items: [
              { label: 'Backlog value', value: fmtMoney(stats.backlogValue) },
              { label: 'Pipeline value', value: fmtMoney(stats.pipelineValue) },
              { label: 'Win rate', value: stats.winRatePercent == null ? '—' : `${Math.round(stats.winRatePercent)}%` },
              { label: 'Sold jobs', value: stats.soldCount },
            ],
          },
          {
            label: 'Profitability',
            items: [
              { label: 'Income YTD', value: fmtMoney(stats.revenueYTD) },
              { label: 'Income MTD', value: fmtMoney(stats.revenueMTD) },
              { label: 'Avg. gross margin', value: stats.avgMarginPercent == null ? '—' : `${Math.round(stats.avgMarginPercent)}%` },
              { label: `Below ${TARGET_MARGIN_PERCENT}% margin`, value: stats.jobsBelowTargetMarginCount, warn: stats.jobsBelowTargetMarginCount > 0 },
            ],
          },
          {
            label: 'Schedule',
            items: [
              { label: 'Starting this week', value: stats.jobsStartingThisWeek.length },
              { label: 'Weather-flagged phases', value: weatherRisk.flaggedCount, warn: weatherRisk.flaggedCount > 0 },
            ],
          },
        ];
        return (
          <div key={key} className="card" style={{ gridColumn: '1 / -1' }}>
            <h3>Key metrics</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px' }}>
              {sections.map(section => (
                <div key={section.label}>
                  <div style={{ fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>{section.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px' }}>
                    {section.items.map(item => {
                      const body = (
                        <div style={{ minWidth: 84 }}>
                          <div style={{ fontSize: 17, fontWeight: 700, color: item.warn ? '#a13f3f' : 'var(--heading)' }}>{item.value}</div>
                          <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', marginTop: 2 }}>{item.label}</div>
                        </div>
                      );
                      return item.href
                        ? <Link key={item.label} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link>
                        : <div key={item.label}>{body}</div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }
      case 'total_profit':
        return (
          <Link key={key} href="/financials" className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <h3>Profit &amp; margin</h3>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Full breakdown on the Financial Dashboard →</div>
          </Link>
        );
      case 'sales_route_ai':
        return (
          <div key={key} className="card sales-route-card" onClick={() => setRouteModalOpen(true)}>
            <h3>Sales route</h3>
            <div className="empty-state" style={{ padding: '8px 0' }}>Click to build a route based on your area, stop count, and property types.</div>
          </div>
        );
      case 'job_counts_by_stage':
        return (
          <div key={key} className="card" style={{ gridColumn: '1 / -1' }}>
            <h3>Job counts by stage</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
              {STAGE_ORDER.map(s => (
                <div key={s} style={{ minWidth: 74, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--heading)' }}>{stats.byStage[s] || 0}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3 }}>{STAGE_LABELS[s]}</div>
                </div>
              ))}
              <div style={{ minWidth: 74, textAlign: 'center', borderLeft: '1px solid var(--line)', paddingLeft: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--heading)' }}>{jobs.length}</div>
                <div style={{ fontSize: 9, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: 3 }}>Total</div>
              </div>
            </div>
          </div>
        );
      case 'overdue_opportunities':
        return (
          <div key={key} className="card">
            <h3>Overdue opportunities</h3>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
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
          </div>
        );
      default:
        return null;
    }
  }

  const orderedKeys = (localOrder || resolveWidgetOrder(settings.dashboard_widget_order)).filter(show);

  function handleDragStart(index) {
    setDragState({ draggingIndex: index, dragOverIndex: null });
  }
  function handleDragOver(index) {
    setDragState(s => (s.draggingIndex === null || s.dragOverIndex === index) ? s : { ...s, dragOverIndex: index });
  }
  async function handleDrop(index) {
    const { draggingIndex } = dragState;
    setDragState({ draggingIndex: null, dragOverIndex: null });
    if (draggingIndex === null || draggingIndex === index) return;

    // Reorder within the visible list the person can actually see and
    // drag, then weave that back into the full (including hidden)
    // order — so a widget that's currently toggled off keeps its
    // relative spot instead of getting shuffled to the end the next
    // time it's turned back on.
    const fullOrder = resolveWidgetOrder(settings.dashboard_widget_order);
    const nextVisible = [...orderedKeys];
    const [moved] = nextVisible.splice(draggingIndex, 1);
    nextVisible.splice(index, 0, moved);

    let vi = 0;
    const nextFull = fullOrder.map(k => orderedKeys.includes(k) ? nextVisible[vi++] : k);

    setLocalOrder(nextFull);
    await supabase.from('app_settings').update({ dashboard_widget_order: nextFull }).eq('id', 1);
  }
  function handleDragEnd() {
    setDragState({ draggingIndex: null, dragOverIndex: null });
  }

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Dashboard</h2>
          {show('new_opportunity_button') && (
            <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
          )}
        </div>

        <div className="dash-cards" style={{ marginBottom: 20 }}>
          {orderedKeys.map((key, index) => {
            const el = renderWidget(key);
            if (!el) return null;
            const dragClasses = [
              dragState.draggingIndex === index ? 'widget-dragging' : '',
              dragState.dragOverIndex === index ? 'widget-drag-over' : '',
            ].filter(Boolean).join(' ');
            return cloneElement(el, {
              key,
              draggable: true,
              onDragStart: () => handleDragStart(index),
              onDragOver: e => { e.preventDefault(); handleDragOver(index); },
              onDrop: e => { e.preventDefault(); handleDrop(index); },
              onDragEnd: handleDragEnd,
              className: [el.props.className, dragClasses].filter(Boolean).join(' '),
              style: { ...el.props.style, cursor: 'grab' },
            });
          })}
        </div>
      </div>

      <RouteBuilderModal open={routeModalOpen} onClose={() => setRouteModalOpen(false)} />
    </AppShell>
  );
}
