'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmt(v) {
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sub Portal → Calendar: dates the company can't work. The office sees them
// on the Crew board and gets a heads-up if one lands on a phase that's
// already scheduled. Only the company's admin login can add or remove them.
export default function SubAvailabilitySection({ company, role }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ start: '', end: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canEdit = role === 'admin';
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const { data } = await supabase.from('company_unavailability').select('*').eq('company_id', company.id).gte('end_date', today).order('start_date');
    setRows(data || []);
  }, [company.id, today]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`sub-unavail-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_unavailability', filter: `company_id=eq.${company.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company.id, load]);

  async function add(e) {
    e.preventDefault();
    if (!form.start) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('add_sub_unavailability', {
      target_company_id: company.id, start_in: form.start, end_in: form.end || form.start, reason_in: form.reason || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setForm({ start: '', end: '', reason: '' });
    load();
  }

  async function remove(id) {
    const { error: err } = await supabase.rpc('remove_sub_unavailability', { target_id: id });
    if (err) { setError(err.message); return; }
    load();
  }

  return (
    <div className="dash-section" style={{ marginTop: 24 }}>
      <h3>Days you can&apos;t work</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Tell us about vacations, other commitments, or a crew that&apos;s out, so we don&apos;t schedule you on those days. If it overlaps work already scheduled, the office is alerted right away.
      </div>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      {rows.length === 0 && <div className="empty-state">Nothing marked. You&apos;re open on all upcoming days.</div>}
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
          <span><b>{fmt(r.start_date)}{r.end_date !== r.start_date ? ` – ${fmt(r.end_date)}` : ''}</b>{r.reason ? ` · ${r.reason}` : ''}</span>
          {canEdit && <button type="button" className="btn btn-sm" onClick={() => remove(r.id)}>Remove</button>}
        </div>
      ))}
      {canEdit ? (
        <form onSubmit={add} style={{ marginTop: 12 }}>
          <div className="two-col">
            <div><label>From</label><input type="date" min={today} value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} required /></div>
            <div><label>To (optional)</label><input type="date" min={form.start || today} value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></div>
            <div><label>Note (optional)</label><input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Crew at another job" /></div>
          </div>
          <div className="section-actions"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Mark unavailable'}</button></div>
        </form>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>Only your company&apos;s admin login can change this.</div>
      )}
    </div>
  );
}
