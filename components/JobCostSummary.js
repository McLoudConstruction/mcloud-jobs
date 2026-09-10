'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { JOB_COST_CATEGORIES, JOB_COST_CATEGORY_LABELS } from '../lib/constants';
import { acceptedChangeOrdersTotal } from '../lib/jobFinancials';

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = { category: 'materials', description: '', amount: '', cost_date: new Date().toISOString().slice(0, 10), status: 'actual' };

export default function JobCostSummary({ jobId, contractPrice, projectedCost, changeOrders, invoiceAmount, invoiceStatus }) {
  const [costs, setCosts] = useState([]);
  const [draws, setDraws] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadCosts = useCallback(async () => {
    const [{ data: c }, { data: d }] = await Promise.all([
      supabase.from('job_costs').select('*').eq('job_id', jobId).order('cost_date', { ascending: false }),
      supabase.from('invoices').select('*').eq('job_id', jobId),
    ]);
    if (c) setCosts(c);
    if (d) setDraws(d);
  }, [jobId]);

  useEffect(() => {
    loadCosts();
    const channel = supabase.channel(`job-costs-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs', filter: `job_id=eq.${jobId}` }, loadCosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, loadCosts)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadCosts]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function addManualCost(e) {
    e.preventDefault();
    if (!form.amount) return;
    setSaving(true);
    await supabase.from('job_costs').insert({
      job_id: jobId,
      category: form.category,
      description: form.description || null,
      amount: parseFloat(form.amount),
      cost_date: form.cost_date,
      status: form.status,
      source_type: 'manual',
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function deleteCost(id) {
    if (!confirm('Delete this cost entry?')) return;
    await supabase.from('job_costs').delete().eq('id', id);
  }

  const totalCommitted = costs.filter(c => c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalActual = costs.filter(c => c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalCosts = totalCommitted + totalActual;
  const approvedCOTotal = acceptedChangeOrdersTotal(changeOrders);
  const adjustedContractValue = contractPrice != null && contractPrice !== '' ? Number(contractPrice) + approvedCOTotal : null;
  const margin = adjustedContractValue != null ? adjustedContractValue - totalCosts : null;
  const marginPercent = margin != null && adjustedContractValue ? (margin / adjustedContractValue) * 100 : null;
  const isOverBudget = projectedCost != null && projectedCost > 0 && totalCosts > Number(projectedCost);

  // ── Cash position ────────────────────────────────────────────────────
  // A job either uses draws (multiple invoices/progress billing) or a
  // single invoice — never both, same assumption DrawsCard/InvoiceCard
  // already make. Falls back to the single-invoice fields on the job
  // itself when no draws exist.
  const usesDraws = draws.length > 0;
  const collected = usesDraws
    ? draws.filter(d => d.status === 'paid').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (invoiceStatus === 'paid' ? Number(invoiceAmount || 0) : 0);
  const outstanding = usesDraws
    ? draws.filter(d => d.status === 'sent').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (invoiceStatus === 'sent' ? Number(invoiceAmount || 0) : 0);
  const notYetBilled = usesDraws
    ? draws.filter(d => d.status === 'not_sent').reduce((s, d) => s + Number(d.amount || 0), 0)
    : (!invoiceAmount ? (adjustedContractValue || 0) : 0);
  // Only cash actually spent counts against cash collected — committed
  // costs haven't left the bank account yet, so they don't belong here
  // the way they do in the accrual-style margin figure above.
  const netCash = collected - totalActual;

  return (
    <div className="card">
      <h3>Job Cost Summary</h3>

      {isOverBudget && (
        <div style={{ background: '#f5dedd', border: '1px solid #c0524f', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#7a2e2c' }}>
          <b>Over budget</b> — {fmtMoney(totalCosts - Number(projectedCost))} over the {fmtMoney(projectedCost)} budget.
        </div>
      )}

      <div className="portal-info-grid" style={{ marginBottom: 18 }}>
        <div>
          <div className="portal-info-label">Contract Price</div>
          <div className="portal-info-value">{fmtMoney(contractPrice)}</div>
        </div>
        <div>
          <div className="portal-info-label">Approved Change Orders</div>
          <div className="portal-info-value">{approvedCOTotal > 0 ? fmtMoney(approvedCOTotal) : '—'}</div>
        </div>
        <div>
          <div className="portal-info-label">Budget (from Estimate tab)</div>
          <div className="portal-info-value" style={{ color: isOverBudget ? '#a13f3f' : undefined }}>{fmtMoney(projectedCost)}</div>
        </div>
        <div>
          <div className="portal-info-label">Committed Costs</div>
          <div className="portal-info-value">{fmtMoney(totalCommitted)}</div>
        </div>
        <div>
          <div className="portal-info-label">Actual Costs</div>
          <div className="portal-info-value">{fmtMoney(totalActual)}</div>
        </div>
        <div>
          <div className="portal-info-label">Est. Margin $ {approvedCOTotal > 0 ? '(incl. COs)' : ''}</div>
          <div className="portal-info-value" style={{ color: margin != null && margin < 0 ? '#a13f3f' : undefined }}>{fmtMoney(margin)}</div>
        </div>
        <div>
          <div className="portal-info-label">Margin %</div>
          <div className="portal-info-value" style={{ color: marginPercent != null && marginPercent < 0 ? '#a13f3f' : undefined }}>{marginPercent != null ? `${marginPercent.toFixed(1)}%` : '—'}</div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
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

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ Add manual cost entry'}</button>
      </div>

      {showForm && (
        <form onSubmit={addManualCost} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div>
              <label>Category</label>
              <select value={form.category} onChange={e => update('category', e.target.value)}>
                {JOB_COST_CATEGORIES.map(c => <option key={c} value={c}>{JOB_COST_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} required /></div>
            <div><label>Date</label><input type="date" value={form.cost_date} onChange={e => update('cost_date', e.target.value)} /></div>
            <div>
              <label>Status</label>
              <select value={form.status} onChange={e => update('status', e.target.value)}>
                <option value="actual">Actual (already spent)</option>
                <option value="committed">Committed (obligated, not yet spent)</option>
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}>Description</label>
          <input value={form.description} onChange={e => update('description', e.target.value)} />
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save cost entry'}</button>
          </div>
        </form>
      )}

      {costs.length === 0 && <div className="empty-state" style={{ marginTop: 14 }}>No costs logged yet.</div>}
      {costs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {costs.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div>
                <b>{fmtMoney(c.amount)}</b> — {JOB_COST_CATEGORY_LABELS[c.category]}
                {c.description && <span style={{ color: 'var(--ink-soft)' }}> · {c.description}</span>}
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                  {c.cost_date} · {c.status === 'committed' ? 'Committed' : 'Actual'} · {c.source_type === 'receipt' ? 'From receipt' : c.source_type === 'work_order' ? 'From work order' : 'Manual entry'}
                </div>
              </div>
              {c.source_type === 'manual' && (
                <button className="btn btn-sm btn-danger" onClick={() => deleteCost(c.id)}>Delete</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
