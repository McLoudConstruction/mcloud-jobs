'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { recomputeSequentialDates } from '../lib/scheduleDates';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ScheduleCard({ jobId, job }) {
  const [phases, setPhases] = useState([]);
  const [scopeActions, setScopeActions] = useState([]);
  const [draft, setDraft] = useState(null); // generated but not yet confirmed
  const [startDate, setStartDate] = useState(job?.scheduled_start_date || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDuration, setEditDuration] = useState(1);
  const [view, setView] = useState('list'); // 'list' | 'timeline'

  const loadPhases = useCallback(async () => {
    const { data } = await supabase.from('job_phases').select('*').eq('job_id', jobId).order('sort_order', { ascending: true });
    if (data) setPhases(data);
  }, [jobId]);

  const loadScopeActions = useCallback(async () => {
    const { data } = await supabase.from('job_scope_actions').select('description, trade, unit_label, quantity').eq('job_id', jobId);
    if (data) setScopeActions(data);
  }, [jobId]);

  useEffect(() => {
    loadPhases();
    loadScopeActions();
    const channel = supabase.channel(`job-phases-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_phases', filter: `job_id=eq.${jobId}` }, loadPhases)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_scope_actions', filter: `job_id=eq.${jobId}` }, loadScopeActions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadPhases, loadScopeActions]);

  async function generate() {
    if (!startDate) { setError('Pick a start date first.'); return; }
    if (scopeActions.length === 0) { setError('Add trade breakdown actions on the Scope tab first — the schedule is built from those.'); return; }
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const res = await fetch('/api/generate-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeActions: scopeActions, startDate, projectType: job?.project_type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate schedule.');
      setDraft(phases.length > 0 ? mergeWithExisting(data.phases, phases, startDate) : data.phases);
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Regenerating shouldn't silently overwrite a duration you already
  // hand-corrected — that duration stays locked, but since everything
  // around it may have shifted, it gets flagged needs_review rather than
  // trusted blindly. Phases whose trade no longer appears in the
  // breakdown at all get appended at the end, still flagged, rather than
  // silently dropped.
  function mergeWithExisting(freshPhases, existingPhases, anchorDate) {
    const manualByKey = new Map(existingPhases.filter(p => p.source === 'manual').map(p => [p.phase_key, p]));
    const freshKeys = new Set(freshPhases.map(p => p.phase_key));

    const merged = freshPhases.map(p => {
      const manual = manualByKey.get(p.phase_key);
      if (!manual) return p;
      return { ...p, duration_days: manual.duration_days, source: 'manual', needs_review: true };
    });

    const orphaned = existingPhases
      .filter(p => p.source === 'manual' && p.phase_key !== 'custom' && !freshKeys.has(p.phase_key))
      .map(p => ({ phase_key: p.phase_key, label: p.label, trade: p.trade, duration_days: p.duration_days, source: 'manual', needs_review: true, orphaned: true }));

    const sequenced = [...merged, ...orphaned].map((p, i) => ({ ...p, sort_order: i }));
    return recomputeSequentialDates(sequenced, anchorDate);
  }

  // Keeps whatever's actually typed in the box (including empty, mid-edit)
  // rather than clamping on every keystroke — clamping immediately is what
  // made backspacing "1" to type "3" impossible, since Number('') || 1
  // snapped the field back to 1 before a new digit could be entered.
  // Dates are recomputed using a provisional fallback so the rest of the
  // list still looks right while this field is mid-edit, but that
  // fallback never overwrites what's actually in the box.
  function updateDraftDuration(index, rawValue) {
    const updated = draft.map((p, i) => i === index ? { ...p, duration_days: rawValue } : p);
    const forDates = updated.map(p => ({ ...p, duration_days: Number(p.duration_days) > 0 ? Number(p.duration_days) : 1 }));
    const recomputed = recomputeSequentialDates(forDates, startDate);
    setDraft(updated.map((p, i) => ({ ...p, start_date: recomputed[i].start_date, end_date: recomputed[i].end_date })));
  }

  // Clamps to a valid integer once the field loses focus, so it never
  // stays blank or invalid after you click away.
  function finalizeDraftDuration(index) {
    const clamped = Math.max(1, Math.round(Number(draft[index].duration_days)) || 1);
    const updated = draft.map((p, i) => i === index ? { ...p, duration_days: clamped } : p);
    setDraft(recomputeSequentialDates(updated, startDate));
  }

  async function confirmDraft() {
    setSaving(true);
    setError('');
    try {
      // Belt-and-suspenders: normalize durations even if Confirm was
      // clicked while a field was still mid-edit (e.g. via Enter key
      // without a blur), so an empty/invalid value never reaches the DB.
      const cleanDraft = recomputeSequentialDates(
        draft.map(p => ({ ...p, duration_days: Math.max(1, Math.round(Number(p.duration_days)) || 1) })),
        startDate
      );
      // Replacing an existing schedule — clear the old phases first so
      // regenerating never leaves stale rows behind.
      if (phases.length > 0) {
        await supabase.from('job_phases').delete().eq('job_id', jobId);
      }
      const { error: insertError } = await supabase.from('job_phases').insert(
        cleanDraft.map(({ orphaned, ...p }) => ({ job_id: jobId, ...p }))
      );
      if (insertError) throw insertError;
      await supabase.from('jobs').update({ schedule_stale_at: null }).eq('id', jobId);
      setDraft(null);
      await loadPhases();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function dismissStale() {
    await supabase.from('jobs').update({ schedule_stale_at: null }).eq('id', jobId);
  }

  function startEditPhase(p) {
    setEditingId(p.id);
    setEditDuration(p.duration_days);
  }

  async function savePhaseEdit(phase) {
    const index = phases.findIndex(p => p.id === phase.id);
    // Recompute from this phase's own (unchanged) start date, cascading
    // the new duration through everything scheduled after it.
    const rebased = phases.slice(index).map((p, i) => i === 0 ? { ...p, duration_days: Math.max(1, Number(editDuration) || 1) } : p);
    const final = recomputeSequentialDates(rebased, phases[index].start_date);

    for (const p of final) {
      await supabase.from('job_phases').update({
        duration_days: p.duration_days,
        start_date: p.start_date,
        end_date: p.end_date,
        source: p.id === phase.id ? 'manual' : p.source,
        needs_review: p.id === phase.id ? false : p.needs_review,
      }).eq('id', p.id);
    }
    setEditingId(null);
    await loadPhases();
  }

  async function removeAllPhases() {
    if (!confirm('Remove the entire schedule? This can\'t be undone.')) return;
    await supabase.from('job_phases').delete().eq('job_id', jobId);
    await supabase.from('jobs').update({ schedule_stale_at: null }).eq('id', jobId);
  }

  const totalDays = (!draft && phases.length > 0)
    ? Math.round((new Date(phases[phases.length - 1].end_date) - new Date(phases[0].start_date)) / 86400000) + 1
    : null;

  return (
    <div className="card">
      <h3>Schedule</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Generated from the trade breakdown on the Scope tab — demo, rough-in, drywall, and finishes are sequenced automatically; you adjust durations, not order.
      </div>

      {job?.schedule_stale_at && phases.length > 0 && !draft && (
        <div style={{ background: 'var(--bg-warning, #fff8e6)', border: '1px solid var(--border-warning, #e8c766)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12.5 }}>
          The trade breakdown has changed since this schedule was generated — phase durations may no longer match the scope.
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => { setStartDate(phases[0]?.start_date || startDate); generate(); }}>Regenerate</button>
            <button className="btn btn-sm" onClick={dismissStale}>Dismiss</button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}
      {warning && <div style={{ fontSize: 12, color: '#8a6d1d', marginBottom: 10 }}>{warning}</div>}

      {!draft && phases.length === 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
          <label>Start date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={generate} disabled={loading}>
              {loading ? 'Generating…' : 'Generate schedule'}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Review before confirming</div>
          {draft.map((p, i) => (
            <div key={p.phase_key + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13, gap: 10, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
              <div>
                <b>{p.label}</b>
                {p.needs_review && <span style={{ fontSize: 10, color: '#8a6d1d' }}> · {p.orphaned ? 'trade no longer in breakdown' : 'duration kept from your edit — review'}</span>}
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input type="number" min="1" value={p.duration_days} onChange={e => updateDraftDuration(i, e.target.value)} onBlur={() => finalizeDraftDuration(i)} style={{ width: 56 }} />
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>days</span>
              </div>
            </div>
          ))}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={confirmDraft} disabled={saving}>{saving ? 'Saving…' : 'Confirm schedule'}</button>
            <button className="btn btn-sm" onClick={() => { setDraft(null); setWarning(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {!draft && phases.length > 0 && (
        <div>
          {totalDays && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
              {fmtDate(phases[0].start_date)} – {fmtDate(phases[phases.length - 1].end_date)} · {totalDays} calendar days
            </div>
          )}

          <div className="section-actions" style={{ marginTop: 0, marginBottom: 12 }}>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`} onClick={() => setView('list')}>List</button>
            <button className={`btn btn-sm ${view === 'timeline' ? 'btn-primary' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
          </div>

          {view === 'timeline' && <TimelineView phases={phases} />}

          {view === 'list' && phases.map(p => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
              {editingId === p.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ flex: 1 }}>{p.label}</b>
                  <input type="number" min="1" value={editDuration} onChange={e => setEditDuration(e.target.value)} style={{ width: 56 }} />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>days</span>
                  <button className="btn btn-sm btn-primary" onClick={() => savePhaseEdit(p)}>Save</button>
                  <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <b>{p.label}</b>{p.source === 'manual' && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}> · edited</span>}
                    {p.needs_review && <span style={{ fontSize: 10, color: '#8a6d1d' }}> · please review</span>}
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtDate(p.start_date)} – {fmtDate(p.end_date)} ({p.duration_days} business days)</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => startEditPhase(p)}>Edit</button>
                </div>
              )}
            </div>
          ))}
          <div className="section-actions">
            <button className="btn btn-sm" onClick={() => { setStartDate(phases[0].start_date); generate(); }}>Regenerate</button>
            <button className="btn btn-sm btn-danger" onClick={removeAllPhases}>Remove schedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Proportional-width bar timeline. Each phase's bar is positioned and
// sized by its share of the overall schedule span (in calendar days,
// since weekends still occupy visual space between business-day phases).
// Editing still happens in List view — this is for seeing overlap and
// pacing at a glance, not for dragging.
function TimelineView({ phases }) {
  const minDate = new Date(phases[0].start_date + 'T00:00:00');
  const maxDate = new Date(phases[phases.length - 1].end_date + 'T00:00:00');
  const totalSpan = Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = Math.round((today - minDate) / 86400000);
  const showToday = todayOffset >= 0 && todayOffset <= totalSpan;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', fontSize: 10, color: 'var(--ink-soft)', marginBottom: 6 }}>
        <div style={{ width: 120, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
          <span>{fmtDate(phases[0].start_date)}</span>
          <span>{fmtDate(phases[phases.length - 1].end_date)}</span>
        </div>
      </div>
      {phases.map(p => {
        const start = new Date(p.start_date + 'T00:00:00');
        const end = new Date(p.end_date + 'T00:00:00');
        const offsetDays = Math.round((start - minDate) / 86400000);
        const spanDays = Math.round((end - start) / 86400000) + 1;
        const leftPct = (offsetDays / totalSpan) * 100;
        const widthPct = Math.max((spanDays / totalSpan) * 100, 2.5); // floor so a 1-day phase stays visible/tappable
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <div style={{ width: 120, flexShrink: 0, fontSize: 11, lineHeight: 1.3 }}>{p.label}</div>
            <div style={{ flex: 1, position: 'relative', height: 20, background: 'var(--panel)', borderRadius: 4 }}>
              <div
                title={`${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`}
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${leftPct}%`, width: `${widthPct}%`,
                  borderRadius: 4,
                  background: p.needs_review ? 'var(--gold)' : 'var(--accent)',
                  opacity: p.needs_review ? 0.85 : 1,
                }}
              />
            </div>
            <div style={{ width: 34, flexShrink: 0, fontSize: 10, color: 'var(--ink-soft)', textAlign: 'right' }}>{p.duration_days}d</div>
          </div>
        );
      })}
      {showToday && (
        <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', marginRight: 5, verticalAlign: 'middle' }} />
          Today falls within this schedule
        </div>
      )}
    </div>
  );
}
