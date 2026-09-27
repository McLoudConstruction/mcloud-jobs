'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { shiftPhases } from '../lib/scheduleConflicts';

const CATEGORIES = [
  { key: 'weather', label: 'Weather' },
  { key: 'material_delay', label: 'Material delay' },
  { key: 'sub_delay', label: 'Sub / trade scheduling' },
  { key: 'customer_change', label: 'Customer change' },
  { key: 'inspection_permit', label: 'Inspection / permit' },
  { key: 'other', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

const todayStr = () => new Date().toISOString().slice(0, 10);
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Schedule tab → "Log a delay". Pushes the remaining schedule back by N
// working days (each phase keeps its own weekend rules), then records why
// and — if you leave the boxes ticked — tells the customer and the subs
// who are on the job. The private note stays internal; only the "note for
// the customer" line is ever sent to them.
export default function ScheduleDelayCard({ jobId, job }) {
  const [phases, setPhases] = useState([]);
  const [delays, setDelays] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from_date: todayStr(), workdays: 1, category: 'weather', internal_note: '', customer_note: '', notify_customer: true, notify_subs: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      supabase.from('job_phases').select('*').eq('job_id', jobId).order('sort_order').order('start_date'),
      supabase.from('schedule_delays').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
    ]);
    setPhases(p.data || []);
    setDelays(d.data || []);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`delays-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_delays', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  const published = useMemo(() => phases.filter(p => p.status !== 'draft'), [phases]);
  const workdays = Math.max(1, Math.min(60, Math.round(Number(form.workdays)) || 1));
  const preview = useMemo(() => shiftPhases(phases, form.from_date, workdays), [phases, form.from_date, workdays]);
  const totalDelayed = delays.reduce((s, d) => s + d.workdays_shifted, 0);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function apply() {
    setError('');
    if (!preview.length) { setError('No phases start on or after that date, so nothing would move.'); return; }
    const publishedAffected = preview.filter(p => p.status !== 'draft').length;
    const msg = `Move ${preview.length} schedule item${preview.length === 1 ? '' : 's'} back ${workdays} working day${workdays === 1 ? '' : 's'}?` +
      `${form.notify_customer ? '\n• The customer will be notified.' : ''}${form.notify_subs ? '\n• Subs with an issued/accepted work order will be notified.' : ''}`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const results = await Promise.all(preview.map(p => supabase.from('job_phases').update({
        start_date: p.start_date, end_date: p.end_date, duration_days: p.duration_days, source: 'manual',
      }).eq('id', p.id)));
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;

      // Keep the job's own scheduled dates in step with the phases so the
      // calendar and dashboard don't keep showing the old finish date.
      const nextPhases = phases.map(p => preview.find(x => x.id === p.id) || p).filter(p => p.status !== 'draft');
      if (nextPhases.length) {
        const patch = {};
        const lastEnd = nextPhases.reduce((m, p) => (p.end_date > m ? p.end_date : m), '');
        const firstStart = nextPhases.reduce((m, p) => (!m || p.start_date < m ? p.start_date : m), '');
        if (job?.scheduled_end_date) patch.scheduled_end_date = lastEnd;
        if (job?.scheduled_start_date && form.from_date <= job.scheduled_start_date) patch.scheduled_start_date = firstStart;
        if (Object.keys(patch).length) await supabase.from('jobs').update(patch).eq('id', jobId);
      }

      const { error: logErr } = await supabase.rpc('log_schedule_delay', {
        target_job_id: jobId, from_date_in: form.from_date, workdays_in: workdays, phases_shifted_in: preview.length,
        category_in: form.category, internal_note_in: form.internal_note || null, customer_note_in: form.customer_note || null,
        notify_customer: form.notify_customer, notify_subs: form.notify_subs,
      });
      if (logErr) throw new Error(`The dates moved, but recording the delay failed: ${logErr.message}`);
      setDone(`Moved ${preview.length} item${preview.length === 1 ? '' : 's'} back ${workdays} working day${workdays === 1 ? '' : 's'}.${publishedAffected ? '' : ' (Only unpublished draft items were affected.)'}`);
      setOpen(false);
      setForm(f => ({ ...f, internal_note: '', customer_note: '', workdays: 1 }));
      await load();
    } catch (e) {
      setError(e.message || String(e));
      await load();
    }
    setBusy(false);
  }

  if (published.length === 0 && delays.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>Schedule delays</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            {delays.length ? `${delays.length} logged · ${totalDelayed} working day${totalDelayed === 1 ? '' : 's'} of slip so far` : 'Weather day, late delivery, failed inspection? Push the schedule back and let everyone know in one step.'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => { setOpen(o => !o); setDone(''); setError(''); }}>{open ? 'Cancel' : 'Log a delay'}</button>
      </div>
      {done && <div style={{ fontSize: 12.5, color: '#3a6b45', margin: '10px 0 0' }}>{done}</div>}

      {open && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div><label>Delay starts (everything from this date on moves)</label><input type="date" value={form.from_date} onChange={e => set('from_date', e.target.value)} /></div>
            <div><label>Push back by (working days)</label><input type="number" min="1" max="60" value={form.workdays} onChange={e => set('workdays', e.target.value)} /></div>
            <div>
              <label>Reason</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <label>Internal note (never shown to the customer or subs)</label>
          <textarea rows={2} value={form.internal_note} onChange={e => set('internal_note', e.target.value)} placeholder="e.g. Supplier missed the truck; window order slipped to the 14th." />
          <label>Note for the customer (optional — sent as written)</label>
          <textarea rows={2} value={form.customer_note} onChange={e => set('customer_note', e.target.value)} placeholder="e.g. We'll confirm the new inspection date as soon as the county gives us one." />
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.notify_customer} onChange={e => set('notify_customer', e.target.checked)} />Notify the customer</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.notify_subs} onChange={e => set('notify_subs', e.target.checked)} />Notify subs on this job</label>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>
            {preview.length
              ? `${preview.length} item${preview.length === 1 ? '' : 's'} will move: ${preview.slice(0, 4).map(p => p.label).join(', ')}${preview.length > 4 ? '…' : ''}. New finish: ${fmtDate(phases.map(p => preview.find(x => x.id === p.id) || p).filter(p => p.status !== 'draft').reduce((m, p) => (p.end_date > m ? p.end_date : m), ''))}.`
              : 'Nothing is scheduled on or after that date.'}
          </div>
          {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          <button className="btn btn-primary btn-sm" onClick={apply} disabled={busy || !preview.length}>{busy ? 'Moving…' : 'Move the schedule'}</button>
        </div>
      )}

      {delays.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {delays.map(d => (
            <div key={d.id} style={{ borderTop: '1px solid var(--line)', padding: '9px 0', fontSize: 12.5 }}>
              <b>+{d.workdays_shifted} working day{d.workdays_shifted === 1 ? '' : 's'}</b> · {CATEGORY_LABEL[d.reason_category] || d.reason_category} · {fmtDate(d.created_at)}
              <span style={{ color: 'var(--ink-soft)' }}> · from {fmtDate(d.from_date)} · {d.phases_shifted} item{d.phases_shifted === 1 ? '' : 's'}{d.customer_notified ? ' · customer told' : ''}{d.subs_notified ? ` · ${d.subs_notified} sub${d.subs_notified === 1 ? '' : 's'} told` : ''}</span>
              {d.internal_note && <div style={{ color: 'var(--ink-soft)' }}>{d.internal_note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
