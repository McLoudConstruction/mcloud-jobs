'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function lineTotal(it) { return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0); }

// Deeper companion to the Overview tab's Job Cost Summary — that card
// answers "are we under budget" and now also carries cash position;
// this one answers "where does the money break down line by line."
export default function BudgetCard({ jobId, job }) {
  const [costs, setCosts] = useState([]);
  const [estimateItems, setEstimateItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from('job_costs').select('*').eq('job_id', jobId),
      supabase.from('job_estimate_items').select('*').eq('job_id', jobId).order('created_at'),
    ]);
    if (c) setCosts(c);
    if (e) setEstimateItems(e);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`budget-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_estimate_items', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  if (!loaded) return null;

  const projectedCost = job.projected_cost != null ? Number(job.projected_cost) : null;

  const totalCommitted = costs.filter(c => c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalActual = costs.filter(c => c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalCosts = totalCommitted + totalActual;

  // ── Budget burn ──────────────────────────────────────────────────────
  const burnPercent = projectedCost ? Math.min(100, (totalCosts / projectedCost) * 100) : null;
  const isOverBudget = projectedCost != null && projectedCost > 0 && totalCosts > projectedCost;

  // ── Priced line items (Estimate → Pricing) ──────────────────────────
  // What was actually keyed in when the job was priced out — the
  // baseline everything else on this page gets measured against.
  //
  // Committed/Actual can only be shown at the group level, not per
  // individual line — job_costs entries (from receipts/work orders/
  // manual entry) aren't linked to a specific job_estimate_items row,
  // only tagged with a broad category. Materials comes from job_costs
  // category 'materials'; Subcontractor Cost comes from category
  // 'subcontractor' (what Work Orders log). Status follows the same
  // committed/actual meaning as the rest of this page: 'committed' is
  // an issued work order or other obligation not yet paid out;
  // 'actual' is a receipt, an invoiced work order, or any other cost
  // that's actually gone out the door.
  const pricedMaterials = estimateItems.filter(it => it.category === 'material').map(it => ({ ...it, total: lineTotal(it) }));
  const pricedLabor = estimateItems.filter(it => it.category === 'labor').map(it => ({ ...it, total: lineTotal(it) }));
  const pricedMaterialsEstimated = pricedMaterials.reduce((s, it) => s + it.total, 0);
  const pricedLaborEstimated = pricedLabor.reduce((s, it) => s + it.total, 0);

  const materialsCommitted = costs.filter(c => c.category === 'materials' && c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
  const materialsActual = costs.filter(c => c.category === 'materials' && c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
  const subcontractorCommitted = costs.filter(c => c.category === 'subcontractor' && c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
  const subcontractorActual = costs.filter(c => c.category === 'subcontractor' && c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);

  // Sales tax — same formula as the Estimate tab's Pricing page (tax
  // applies to materials only, not subcontractor cost), so this total
  // actually reconciles with what's on that page instead of quietly
  // running short by whatever the tax line came to.
  const taxPercent = job.estimate_sales_tax_percent != null ? Number(job.estimate_sales_tax_percent) : 0;
  const salesTaxEstimated = pricedMaterialsEstimated * (taxPercent / 100);

  const estimatedTotal = pricedMaterialsEstimated + salesTaxEstimated + pricedLaborEstimated;
  const committedTotal = materialsCommitted + subcontractorCommitted;
  const actualTotal = materialsActual + subcontractorActual;

  return (
    <div className="card">
      <h3>Budget</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
        Where the money's going, line by line — for cash position and margin, see the Overview tab.
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

      {/* Priced line items, straight from Estimate → Pricing */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 4 }}>
          Priced Line Items
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 10 }}>
          Estimated is every line from the Estimate tab's Pricing page, including sales tax. Committed and Actual are only trackable by group, not per line: Committed is issued work orders/POs not yet paid; Actual is receipts, invoiced work orders, and other logged expenses.
        </div>

        {estimateItems.length === 0 && <div className="empty-state">Nothing priced out yet — add materials and subcontractor cost on the Estimate tab.</div>}

        {estimateItems.length > 0 && (
          <div className="budget-table-scroll">
          <div className="budget-table-inner">
            <div className="budget-line-row budget-line-header">
              <span>Description</span>
              <b>Estimated Cost</b>
              <b>Committed Cost</b>
              <b>Actual Cost</b>
            </div>

            {pricedMaterials.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="budget-line-group-label">Materials</div>
                {pricedMaterials.map(it => (
                  <div className="budget-line-row" key={it.id}>
                    <span>{it.description}</span>
                    <b>{fmtMoney(it.total)}</b>
                    <span className="budget-line-na">—</span>
                    <span className="budget-line-na">—</span>
                  </div>
                ))}
                <div className="budget-line-row budget-line-subtotal">
                  <span>Materials subtotal</span>
                  <b>{fmtMoney(pricedMaterialsEstimated)}</b>
                  <b>{fmtMoney(materialsCommitted)}</b>
                  <b>{fmtMoney(materialsActual)}</b>
                </div>
              </div>
            )}

            {taxPercent > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="budget-line-row">
                  <span>Sales Tax ({taxPercent}% of materials)</span>
                  <b>{fmtMoney(salesTaxEstimated)}</b>
                  <span className="budget-line-na">—</span>
                  <span className="budget-line-na" title="Any tax paid is already folded into what receipts log as their total — not broken out separately.">—</span>
                </div>
              </div>
            )}

            {pricedLabor.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="budget-line-group-label">Subcontractor Cost</div>
                {pricedLabor.map(it => (
                  <div className="budget-line-row" key={it.id}>
                    <span>{it.unit_label || it.description}</span>
                    <b>{fmtMoney(it.total)}</b>
                    <span className="budget-line-na">—</span>
                    <span className="budget-line-na">—</span>
                  </div>
                ))}
                <div className="budget-line-row budget-line-subtotal">
                  <span>Subcontractor Cost subtotal</span>
                  <b>{fmtMoney(pricedLaborEstimated)}</b>
                  <b>{fmtMoney(subcontractorCommitted)}</b>
                  <b>{fmtMoney(subcontractorActual)}</b>
                </div>
              </div>
            )}

            <div className="budget-line-row budget-line-grand-total">
              <span>Total</span>
              <b>{fmtMoney(estimatedTotal)}</b>
              <b>{fmtMoney(committedTotal)}</b>
              <b>{fmtMoney(actualTotal)}</b>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
