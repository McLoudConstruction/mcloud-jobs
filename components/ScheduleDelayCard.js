'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { delayAnchor, followerCandidates, applyCascade } from '../lib/scheduleCascade';

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
  const [form, setForm] = useState({ phase_id: '', workdays: 1, category: 'weather', internal_note: '', customer_note: '', notify_customer: true, notify_subs: true });
  const [picked, setPicked] = useState(null); // Set of follower ids; null = use the defaults for the chosen phase
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

  const today = todayStr();
  const published = useMemo(() => phases.filter(p => p.status !== 'draft'), [phases]);
  // Phases that can still slip: anything not already finished.
  const openPhases = useMemo(() => published.filter(p => p.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.sort_order ?? 0) - (b.sort_order ?? 0)), [published, today]);
  // Default to the phase underway today, otherwise the next one to start.
  const defaultPhaseId = useMemo(() => (openPhases.find(p => p.start_date <= today && p.end_date >= today) || openPhases[0])?.id || '', [openPhases, today]);
  const phaseId = form.phase_id || defaultPhaseId;
  const delayed = openPhases.find(p => p.id === phaseId) || null;
  const workdays = Math.max(1, Math.min(60, Math.round(Number(form.workdays)) || 1));
  const candidates = useMemo(() => (delayed ? followerCandidates(published, delayed, today) : []), [published, delayed, today]);
  const followerIds = useMemo(() => picked || new Set(candidates.filter(c => c.checked).map(c => c.phase.id)), [picked, candidates]);
  // What actually changes: the delayed phase, plus only the followers left ticked.
  const preview = useMemo(() => {
    if (!delayed) return [];
    const anchor = delayAnchor(delayed, workdays, today);
    return [anchor, ...applyCascade(candidates.map(c => c.phase), [...followerIds], workdays)];
  }, [delayed, workdays, candidates, followerIds, today]);
  const totalDelayed = delays.reduce((s, d) => s + d.workdays_shifted, 0);

  function togglePhaseFollower(id) {
    const next = new Set(followerIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  }

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function apply() {
    setError('');
    if (!delayed) { setError('Pick the phase that is delayed.'); return; }
    const publishedAffected = preview.filter(p => p.status !== 'draft').length;
    const msg = `Delay ${delayed.label} by ${workdays} working day${workdays === 1 ? '' : 's'}${preview.length > 1 ? ` and move ${preview.length - 1} following phase${preview.length === 2 ? '' : 's'}` : ' (nothing after it moves)'}?` +
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
        if (job?.scheduled_start_date && delayed.start_date <= job.scheduled_start_date) patch.scheduled_start_date = firstStart;
        if (Object.keys(patch).length) await supabase.from('jobs').update(patch).eq('id', jobId);
      }

      const { error: logErr } = await supabase.rpc('log_schedule_delay', {
        target_job_id: jobId, from_date_in: delayed.start_date, workdays_in: workdays, phases_shifted_in: preview.length,
        category_in: form.category, internal_note_in: form.internal_note || null, customer_note_in: form.customer_note || null,
        notify_customer: form.notify_customer, notify_subs: form.notify_subs,
      });
      if (logErr) throw new Error(`The dates moved, but recording the delay failed: ${logErr.message}`);
      setDone(`Moved ${preview.length} item${preview.length === 1 ? '' : 's'} back ${workdays} working day${workdays === 1 ? '' : 's'}.${publishedAffected ? '' : ' (Only unpublished draft items were affected.)'}`);
      setOpen(false);
      setForm(f => ({ ...f, internal_note: '', customer_note: '', workdays: 1, phase_id: '' }));
      setPicked(null);
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
            {delays.length ? `${delays.length} logged · ${totalDelayed} working day${totalDelayed === 1 ? '' : 's'} of slip so far` : 'Weather day, late delivery, failed inspection? Delay one phase, pick which phases after it move, and let everyone know in one step.'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => { setOpen(o => !o); setDone(''); setError(''); }}>{open ? 'Cancel' : 'Log a delay'}</button>
      </div>
      {done && <div style={{ fontSize: 12.5, color: '#3a6b45', margin: '10px 0 0' }}>{done}</div>}

      {open && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div>
              <label>Which phase is delayed?</label>
              <select value={phaseId} onChange={e => { set('phase_id', e.target.value); setPicked(null); }}>
                {openPhases.map(p => <option key={p.id} value={p.id}>{p.label} ({fmtDate(p.start_date)} to {fmtDate(p.end_date)})</option>)}
              </select>
            </div>
            <div><label>Delayed by (working days)</label><input type="number" min="1" max="60" value={form.workdays} onChange={e => set('workdays', e.target.value)} /></div>
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
          <label style={{ marginTop: 4 }}>Which following phases move with it?</label>
          {candidates.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>No phases come after this one, so only it moves.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, margin: '4px 0 6px' }}>
                <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set(candidates.map(c => c.phase.id)))}>Select all</button>
                <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set())}>Select none</button>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card-bg)', maxHeight: 260, overflowY: 'auto', marginBottom: 10 }}>
                {candidates.map(c => {
                  const p = c.phase;
                  const on = followerIds.has(p.id);
                  const next = preview.find(x => x.id === p.id);
                  return (
                    <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', borderBottom: '1px solid var(--line)', fontWeight: 400, cursor: 'pointer' }}>
                      <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={on} onChange={() => togglePhaseFollower(p.id)} />
                      <span style={{ flex: 1, fontSize: 12.5 }}>
                        <b>{p.label}</b>{c.linked && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · linked</span>}
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-soft)' }}>
                          {fmtDate(p.start_date)} to {fmtDate(p.end_date)}{on && next ? `  →  ${fmtDate(next.start_date)} to ${fmtDate(next.end_date)}` : '  (stays put)'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>
            {delayed
              ? `${delayed.label} ${delayed.start_date > today ? 'moves' : 'finishes'} ${workdays} working day${workdays === 1 ? '' : 's'} later${preview.length > 1 ? `, and ${preview.length - 1} following phase${preview.length === 2 ? '' : 's'} move${preview.length === 2 ? 's' : ''} with it` : ''}. New finish: ${fmtDate(published.map(p => preview.find(x => x.id === p.id) || p).reduce((m, p) => (p.end_date > m ? p.end_date : m), ''))}.`
              : 'Nothing left to delay on this schedule.'}
          </div>
          {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          <button className="btn btn-primary btn-sm" onClick={apply} disabled={busy || !preview.length}>{busy ? 'Moving…' : 'Apply delay'}</button>
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
