'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_LABELS = { not_sent: 'Not Sent', sent: 'Sent', paid: 'Paid' };
const EMPTY_FORM = { description: '', amount: '' };

export default function DrawsCard({ jobId }) {
  const [draws, setDraws] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadDraws = useCallback(async () => {
    const { data } = await supabase.from('invoices').select('*').eq('job_id', jobId).order('created_at', { ascending: true });
    if (data) setDraws(data);
  }, [jobId]);

  useEffect(() => {
    loadDraws();
    const channel = supabase.channel(`draws-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, loadDraws).subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadDraws]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function addDraw(e) {
    e.preventDefault();
    if (!form.amount) return;
    setSaving(true);
    await supabase.from('invoices').insert({
      job_id: jobId,
      description: form.description || `Draw ${draws.length + 1}`,
      amount: parseFloat(form.amount),
      status: 'not_sent',
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function markPaid(d) {
    await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', d.id);
  }

  async function deleteDraw(d) {
    if (!confirm('Delete this draw? This cannot be undone.')) return;
    await supabase.from('invoices').delete().eq('id', d.id);
  }

  if (draws.length === 0 && !showForm) {
    return (
      <div className="card">
        <h3>Invoicing</h3>
        <div className="empty-state">
          No draws yet — these are created automatically when the job moves to Approved (Deposit + Final Payment, matching your standard contract terms), or you can add one manually below.
        </div>
        <div className="section-actions">
          <button className="btn btn-sm" onClick={() => setShowForm(true)}>+ Add a draw manually</button>
        </div>
      </div>
    );
  }

  const total = draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  const paidTotal = draws.filter(d => d.status === 'paid').reduce((s, d) => s + Number(d.amount || 0), 0);

  return (
    <div className="card">
      <h3>Invoicing</h3>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        {fmtMoney(paidTotal)} collected of {fmtMoney(total)} across {draws.length} draw{draws.length === 1 ? '' : 's'}
      </div>

      {draws.map(d => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
          <div>
            <b>{d.description || 'Draw'}</b> — {fmtMoney(d.amount)}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{STATUS_LABELS[d.status]}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Link href={`/jobs/${jobId}/invoices/${d.id}`} className="btn btn-sm">View</Link>
            {d.status === 'sent' && <button className="btn btn-sm" onClick={() => markPaid(d)}>Mark Paid</button>}
            <button className="btn btn-sm btn-danger" onClick={() => deleteDraw(d)}>Delete</button>
          </div>
        </div>
      ))}

      <div className="section-actions">
        <button className="btn btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ Add another draw'}</button>
      </div>

      {showForm && (
        <form onSubmit={addDraw} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div><label>Description</label><input value={form.description} onChange={e => update('description', e.target.value)} placeholder="e.g. Draw 3 — Rough-in complete" /></div>
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} required /></div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save draw'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
