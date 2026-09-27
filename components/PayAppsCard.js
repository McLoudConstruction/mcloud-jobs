'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { toCents, fromCents, fmtCents, allocateCents } from '../lib/payAppMath';
import { isChangeOrderAccepted } from '../lib/jobFinancials';
import { useSettings } from '../lib/useSettings';

const STATUS = {
  draft: { label: 'Draft', color: '#6b6350', bg: '#efece2' },
  submitted: { label: 'Submitted', color: '#2f4858', bg: '#e6edf1' },
  approved: { label: 'Approved', color: '#a17c3f', bg: '#f7efdc' },
  paid: { label: 'Paid', color: '#3a6b45', bg: '#e7f1e9' },
  void: { label: 'Void', color: '#6b6350', bg: '#efece2' },
};

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Financials → Pay Apps. Two things live here: the Schedule of Values (the
// contract broken into billable lines — AIA G703's column C) and the list of
// pay applications billed against it. Figures are computed in
// lib/payAppMath.js and frozen into each application when it's submitted.
export default function PayAppsCard({ jobId, job, changeOrders = [] }) {
  const { settings } = useSettings();
  const [sov, setSov] = useState([]);
  const [apps, setApps] = useState([]);
  const [billedLineIds, setBilledLineIds] = useState(new Set());
  const [showSov, setShowSov] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('pay_app_sov_lines').select('*').eq('job_id', jobId).order('sort_order').order('created_at'),
      supabase.from('pay_applications').select('*').eq('job_id', jobId).order('application_no'),
    ]);
    setSov(s.data || []);
    setApps(a.data || []);
    const live = (a.data || []).filter(x => !['draft', 'void'].includes(x.status)).map(x => x.id);
    if (live.length) {
      const { data: ls } = await supabase.from('pay_app_lines').select('sov_line_id').in('application_id', live);
      setBilledLineIds(new Set((ls || []).map(l => l.sov_line_id)));
    } else setBilledLineIds(new Set());
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`payapps-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pay_applications', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pay_app_sov_lines', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  const contractCents = toCents(job?.contract_price);
  const acceptedCOs = (changeOrders || []).filter(co => isChangeOrderAccepted(co) && !co.declined_at);
  const linkedCoIds = new Set(sov.filter(l => l.change_order_id).map(l => l.change_order_id));
  const unsyncedCOs = acceptedCOs.filter(co => !linkedCoIds.has(co.id));
  const sovTotalCents = sov.reduce((s, l) => s + toCents(l.scheduled_value), 0);
  const expectedCents = contractCents + acceptedCOs.reduce((s, co) => s + toCents(co.amount), 0);
  const mismatch = sov.length > 0 && expectedCents > 0 && sovTotalCents !== expectedCents;

  async function run(fn) {
    setBusy(true);
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  }

  const seedLump = () => run(async () => {
    if (!contractCents) throw new Error('This job has no contract price yet — set the price first.');
    const { error: err } = await supabase.from('pay_app_sov_lines').insert({ job_id: jobId, sort_order: 1, item_no: '1', description: 'Contract work (lump sum)', scheduled_value: fromCents(contractCents) });
    if (err) throw err;
  });

  const seedScope = () => run(async () => {
    if (!contractCents) throw new Error('This job has no contract price yet — set the price first.');
    const items = (job.scope_items || []).map(s => (s.text || '').trim()).filter(Boolean);
    if (!items.length) throw new Error('This job has no scope items to split the price across.');
    const parts = allocateCents(contractCents, items.map(() => 1));
    const rows = items.map((text, i) => ({ job_id: jobId, sort_order: i + 1, item_no: String(i + 1), description: text.slice(0, 200), scheduled_value: fromCents(parts[i]) }));
    const { error: err } = await supabase.from('pay_app_sov_lines').insert(rows);
    if (err) throw err;
    setShowSov(true);
  });

  const syncCOs = () => run(async () => {
    const start = sov.reduce((m, l) => Math.max(m, l.sort_order || 0), 0);
    const rows = unsyncedCOs.map((co, i) => ({
      job_id: jobId, sort_order: start + i + 1, item_no: `CO${start + i + 1}`, kind: 'change_order', change_order_id: co.id,
      description: `Change order: ${(co.description || '').slice(0, 160) || 'approved change'}`, scheduled_value: Number(co.amount || 0),
    }));
    const { error: err } = await supabase.from('pay_app_sov_lines').insert(rows);
    if (err) throw err;
  });

  const addLine = () => run(async () => {
    const next = sov.reduce((m, l) => Math.max(m, l.sort_order || 0), 0) + 1;
    const { error: err } = await supabase.from('pay_app_sov_lines').insert({ job_id: jobId, sort_order: next, item_no: String(next), description: 'New line', scheduled_value: 0 });
    if (err) throw err;
  });

  async function saveLine(l, patch) {
    const { error: err } = await supabase.from('pay_app_sov_lines').update(patch).eq('id', l.id);
    if (err) { setError(err.message); await load(); return; }
    setError('');
    await load();
  }

  const removeLine = l => {
    if (!confirm('Delete this Schedule of Values line?')) return;
    run(async () => {
      const { error: err } = await supabase.from('pay_app_sov_lines').delete().eq('id', l.id);
      if (err) throw err;
    });
  };

  const newApp = () => run(async () => {
    const last = apps.filter(a => a.status !== 'void').slice(-1)[0];
    const today = new Date().toISOString().slice(0, 10);
    const { data, error: err } = await supabase.from('pay_applications').insert({
      job_id: jobId,
      period_from: last?.period_to || null,
      period_to: today,
      owner_name: job.company_name || job.customer_name || null,
      owner_address: job.project_address || null,
      project_name: job.project_address || job.customer_name || null,
      contract_date: job.contract_finalized_at ? job.contract_finalized_at.slice(0, 10) : null,
      retainage_completed_percent: last?.retainage_completed_percent ?? settings?.default_retainage_percent ?? 10,
      retainage_stored_percent: last?.retainage_stored_percent ?? settings?.default_retainage_percent ?? 10,
    }).select('id').single();
    if (err) throw err;
    window.location.href = `/jobs/${jobId}/pay-apps/${data.id}`;
  });

  if (!loaded) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>Pay Applications</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            AIA-style progress billing (G702 / G703) against a Schedule of Values. Submitting one creates the matching invoice.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setShowSov(s => !s)}>{showSov ? 'Hide' : 'Edit'} Schedule of Values</button>
          <button className="btn btn-primary btn-sm" onClick={newApp} disabled={busy || sov.length === 0}>+ New pay application</button>
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: '#a13f3f', margin: '10px 0' }}>{error}</div>}

      {sov.length === 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}><b>Start with a Schedule of Values.</b> It breaks the contract price ({fmtCents(contractCents)}) into the lines you&apos;ll bill against.</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={seedLump} disabled={busy}>One lump-sum line</button>
            <button className="btn btn-sm" onClick={seedScope} disabled={busy}>One line per scope item (split evenly — then adjust)</button>
            <button className="btn btn-sm" onClick={addLine} disabled={busy}>Build it by hand</button>
          </div>
        </div>
      )}

      {sov.length > 0 && unsyncedCOs.length > 0 && (
        <div style={{ background: '#f7efdc', border: '1px solid #e6d3a3', borderRadius: 6, padding: '10px 14px', marginTop: 12, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{unsyncedCOs.length} signed change order{unsyncedCOs.length === 1 ? ' is' : 's are'} not on the Schedule of Values yet.</span>
          <button className="btn btn-sm" onClick={syncCOs} disabled={busy}>Add {unsyncedCOs.length === 1 ? 'it' : 'them'}</button>
        </div>
      )}

      {showSov && sov.length > 0 && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-soft)', fontSize: 11 }}>
                <th style={{ width: 60 }}>Item</th><th>Description</th><th style={{ width: 130, textAlign: 'right' }}>Scheduled value</th><th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {sov.map(l => {
                const locked = billedLineIds.has(l.id);
                return (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td><input defaultValue={l.item_no || ''} onBlur={e => e.target.value !== (l.item_no || '') && saveLine(l, { item_no: e.target.value })} style={{ width: 52 }} /></td>
                    <td><input defaultValue={l.description} onBlur={e => e.target.value !== l.description && e.target.value.trim() && saveLine(l, { description: e.target.value.trim() })} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        defaultValue={Number(l.scheduled_value).toFixed(2)}
                        disabled={locked}
                        title={locked ? 'Already billed on a submitted pay application — change it with a change order.' : ''}
                        inputMode="decimal"
                        style={{ textAlign: 'right' }}
                        onBlur={e => {
                          const v = fromCents(toCents(e.target.value.replace(/[^0-9.]/g, '')));
                          if (v !== Number(l.scheduled_value)) saveLine(l, { scheduled_value: v });
                        }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>{!locked && <button className="btn btn-sm btn-danger" onClick={() => removeLine(l)}>×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                <td /><td>Total</td><td style={{ textAlign: 'right' }}>{fmtCents(sovTotalCents)}</td><td />
              </tr>
            </tfoot>
          </table>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={addLine} disabled={busy}>+ Add line</button>
            {mismatch && (
              <span style={{ fontSize: 12, color: '#a17c3f' }}>
                Total is {fmtCents(sovTotalCents)} but the contract{acceptedCOs.length ? ' plus signed change orders' : ''} comes to {fmtCents(expectedCents)} ({sovTotalCents > expectedCents ? 'over' : 'under'} by {fmtCents(Math.abs(sovTotalCents - expectedCents))}).
              </span>
            )}
          </div>
        </div>
      )}

      {apps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {apps.map(a => {
            const st = STATUS[a.status] || STATUS.draft;
            const due = a.snapshot?.g702?.current_payment_due;
            return (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
                <div>
                  <b>Pay Application #{a.application_no}</b>{due !== undefined ? ` — ${fmtCents(due)} due` : ''}
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Period ending {fmtDate(a.period_to)}{a.submitted_at ? ` · submitted ${fmtDate(a.submitted_at)}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg }}>{st.label}</span>
                  <Link href={`/jobs/${jobId}/pay-apps/${a.id}`} className="btn btn-sm">{a.status === 'draft' ? 'Edit' : 'View'}</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {apps.length === 0 && sov.length > 0 && <div className="empty-state" style={{ marginTop: 12 }}>No pay applications yet.</div>}
    </div>
  );
}
