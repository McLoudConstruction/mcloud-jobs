'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { JOB_COST_CATEGORY_LABELS } from '../lib/constants';
import { acceptedChangeOrdersTotal } from '../lib/jobFinancials';

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Deeper companion to the Overview tab's Job Cost Summary — that card
// answers "are we under budget"; this one answers "where is the money
// going" and "are we ahead or behind on cash", which need their own
// room rather than being squeezed into the same card.
export default function BudgetCard({ jobId, job, changeOrders }) {
  const [costs, setCosts] = useState([]);
  const [draws, setDraws] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: d }] = await Promise.all([
      supabase.from('job_costs').select('*').eq('job_id', jobId),
      supabase.from('invoices').select('*').eq('job_id', jobId),
    ]);
    if (c) setCosts(c);
    if (d) setDraws(d);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`budget-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  if (!loaded) return null;

  const contractPrice = job.contract_price != null ? Number(job.contract_price) : null;
  const projectedCost = job.projected_cost != null ? Number(job.projected_cost) : null;
  const approvedCOTotal = acceptedChangeOrdersTotal(changeOrders);
  const adjustedContractValue = contractPrice != null ? contractPrice + approvedCOTotal : null;

  const totalCommitted = costs.filter(c => c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalActual = costs.filter(c => c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalCosts = totalCommitted + totalActual;

  // ── Cost breakdown by category ──────────────────────────────────────
  const byCategory = {};
  costs.forEach(c => {
    const key = c.category || 'other';
    if (!byCategory[key]) byCategory[key] = { committed: 0, actual: 0 };
    byCategory[key][c.status === 'committed' ? 'committed' : 'actual'] += Number(c.amount || 0);
  });
  const categoryRows = Object.entries(byCategory)
    .map(([key, v]) => ({ key, label: JOB_COST_CATEGORY_LABELS[key] || key, total: v.committed + v.actual, ...v }))
    .sort((a, b) => b.total - a.total);
  const maxCategoryTotal = Math.max(1, ...categoryRows.map(r => r.total));

  // ── Budget burn ──────────────────────────────────────────────────────
  const burnPercent = projectedCost ? Math.min(100, (totalCosts / projectedCost) * 100) : null;
  const isOverBudget = projectedCost != null && projectedCost > 0 && totalCosts > projectedCost;

  // ── Cash position ────────────────────────────────────────────────────
  // A job either uses draws (multiple invoices/progress billing) or a
  // single invoice — never both, same assumption DrawsCard/InvoiceCard
  // already make. Falls back to the single-invoice fields on the job
  // itself when no draws exist.
  const usesDraws = draws.length > 0;
  const collected = usesDraws
    ? draws.filter(d => d.status === 'paid').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (job.invoice_status === 'paid' ? Number(job.invoice_amount || 0) : 0);
  const outstanding = usesDraws
    ? draws.filter(d => d.status === 'sent').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (job.invoice_status === 'sent' ? Number(job.invoice_amount || 0) : 0);
  const notYetBilled = usesDraws
    ? draws.filter(d => d.status === 'not_sent').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (!job.invoice_amount ? (adjustedContractValue || 0) : 0);
  // Only cash actually spent counts against cash collected — committed
  // costs haven't left the bank account yet, so they don't belong here
  // the way they do in the accrual-style margin figure above.
  const netCash = collected - totalActual;

  return (
    <div className="card">
      <h3>Budget</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
        Where the money's going and how cash is tracking — for the budget-vs-actual totals, see the Overview tab.
      </div>

      {/* Cost breakdown by category */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
          Cost Breakdown by Category
        </div>
        {categoryRows.length === 0 && <div className="empty-state">No costs logged yet.</div>}
        {categoryRows.length > 0 && (
          <>
            <div className="budget-legend">
              <span><span className="budget-legend-swatch" style={{ background: 'var(--accent)' }} />Actual</span>
              <span><span className="budget-legend-swatch" style={{ background: 'var(--gold)', opacity: 0.55 }} />Committed</span>
            </div>
            {categoryRows.map(r => (
              <div className="budget-cat-row" key={r.key}>
                <div className="budget-cat-row-head">
                  <span>{r.label}</span>
                  <b>{fmtMoney(r.total)}</b>
                </div>
                <div className="budget-cat-bar">
                  <div className="budget-cat-bar-actual" style={{ width: `${(r.actual / maxCategoryTotal) * 100}%` }} />
                  <div className="budget-cat-bar-committed" style={{ width: `${(r.committed / maxCategoryTotal) * 100}%` }} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Budget burn */}
      {projectedCost != null && (
        <div className="budget-burn-wrap">
          <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
            Budget Burn
          </div>
          <div className="budget-burn-track">
            <div className={`budget-burn-fill ${isOverBudget ? 'over' : ''}`} style={{ width: `${burnPercent}%` }} />
          </div>
          <div className="budget-burn-label">
            <span>{fmtMoney(totalCosts)} of {fmtMoney(projectedCost)} budget used</span>
            <span style={{ color: isOverBudget ? '#a13f3f' : undefined, fontWeight: isOverBudget ? 700 : undefined }}>
              {isOverBudget ? `${((totalCosts / projectedCost) * 100).toFixed(0)}% — over budget` : `${burnPercent.toFixed(0)}%`}
            </span>
          </div>
        </div>
      )}

      {/* Cash position */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
          Cash Position
        </div>
        <div className="portal-info-grid">
          <div>
            <div className="portal-info-label">Collected</div>
            <div className="portal-info-value" style={{ color: '#3a6b45' }}>{fmtMoney(collected)}</div>
          </div>
          <div>
            <div className="portal-info-label">Outstanding (sent, unpaid)</div>
            <div className="portal-info-value">{fmtMoney(outstanding)}</div>
          </div>
          <div>
            <div className="portal-info-label">Not Yet Billed</div>
            <div className="portal-info-value">{fmtMoney(notYetBilled)}</div>
          </div>
          <div>
            <div className="portal-info-label">Net Cash Position</div>
            <div className="portal-info-value" style={{ color: netCash < 0 ? '#a13f3f' : '#3a6b45' }}>{fmtMoney(netCash)}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 10 }}>
          Net cash position is what's been collected minus what's actually been spent — committed-but-unpaid costs aren't counted against it yet.
        </div>
      </div>
    </div>
  );
}
