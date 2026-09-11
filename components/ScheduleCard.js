'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { recomputeSequentialDates } from '../lib/scheduleDates';
import { phaseBackground, tradesForPhase } from '../lib/tradeColors';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const START_DAY_OPTIONS = [
  { value: '', label: 'No preference' },
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
];

function dayLabel(value) {
  return START_DAY_OPTIONS.find(o => o.value === value)?.label || '';
}

// Small color swatch used in both List and Timeline rows — needs_review
// always wins over the trade color(s), since that flag is meant to be
// unambiguous regardless of what trade the phase belongs to.
function PhaseSwatch({ phase, size = 14 }) {
  return (
    <span
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: 3,
        background: phase.needs_review ? 'var(--gold)' : phaseBackground(phase),
        flexShrink: 0,
      }}
    />
  );
}

// Distinct trades represented across the current phase set, for the
// legend — only what's actually present, not the full 19-trade list.
function legendEntries(phases) {
  const seen = new Map();
  for (const p of phases) {
    for (const t of tradesForPhase(p)) {
      if (!seen.has(t)) seen.set(t, true);
    }
  }
  return [...seen.keys()];
}

function Legend({ phases }) {
  const trades = legendEntries(phases);
  const anyFlagged = phases.some(p => p.needs_review);
  if (trades.length === 0 && !anyFlagged) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
      {trades.map(t => (
        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <PhaseSwatch phase={{ trade: t, phase_key: null }} size={10} />
          {t}
        </span>
      ))}
      {anyFlagged && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <PhaseSwatch phase={{ needs_review: true }} size={10} />
          Check on this
        </span>
      )}
    </div>
  );
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
  const [editPreferredStartDay, setEditPreferredStartDay] = useState('');
  const [editAllowWeekend, setEditAllowWeekend] = useState(false);
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
      return {
        ...p, duration_days: manual.duration_days, source: 'manual', needs_review: true,
        preferred_start_day: manual.preferred_start_day, allow_weekend_work: manual.allow_weekend_work,
      };
    });

    const orphaned = existingPhases
      .filter(p => p.source === 'manual' && p.phase_key !== 'custom' && !freshKeys.has(p.phase_key))
      .map(p => ({
        phase_key: p.phase_key, label: p.label, trade: p.trade, duration_days: p.duration_days,
        source: 'manual', needs_review: true, orphaned: true,
        preferred_start_day: p.preferred_start_day, allow_weekend_work: p.allow_weekend_work,
      }));

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

  function updateDraftPreferredStartDay(index, value) {
    const updated = draft.map((p, i) => i === index ? { ...p, preferred_start_day: value || null } : p);
    setDraft(recomputeSequentialDates(updated, startDate));
  }

  function updateDraftAllowWeekend(index, allow) {
    const updated = draft.map((p, i) => i === index ? { ...p, allow_weekend_work: allow } : p);
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
    setEditPreferredStartDay(p.preferred_start_day || '');
    setEditAllowWeekend(!!p.allow_weekend_work);
  }

  async function savePhaseEdit(phase) {
    const index = phases.findIndex(p => p.id === phase.id);
    // Recompute from this phase's own (unchanged) start date, cascading
    // the new duration through everything scheduled after it.
    const rebased = phases.slice(index).map((p, i) => i === 0
      ? { ...p, duration_days: Math.max(1, Number(editDuration) || 1), preferred_start_day: editPreferredStartDay || null, allow_weekend_work: editAllowWeekend }
      : p);
    const final = recomputeSequentialDates(rebased, phases[index].start_date);

    for (const p of final) {
      await supabase.from('job_phases').update({
        duration_days: p.duration_days,
        start_date: p.start_date,
        end_date: p.end_date,
        preferred_start_day: p.preferred_start_day,
        allow_weekend_work: p.allow_weekend_work,
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
    // The realtime subscription should pick this up on its own, but
    // don't rely on it alone — explicitly reload so the list clears
    // immediately instead of waiting on a refresh.
    await loadPhases();
  }

  // Persists a drag (move) or edge-resize (duration change) from the
  // Timeline view. Deliberately independent of every other phase — no
  // cascade, overlap allowed — since dragging on a calendar is a direct,
  // confident placement, not a "shift everything downstream" edit like
  // the List view's duration field is. Never sets needs_review: you were
  // looking right at it when you dropped it.
  async function updatePhaseDates(phaseId, { start_date, end_date, duration_days }) {
    await supabase.from('job_phases').update({
      start_date, end_date, duration_days, source: 'manual', needs_review: false,
    }).eq('id', phaseId);
    await loadPhases();
  }

  const totalDays = (!draft && phases.length > 0)
    ? Math.round((new Date(phases[phases.length - 1].end_date) - new Date(phases[0].start_date)) / 86400000) + 1
    : null;

  return (
    <div className="card">
      <h3 style={{ margin: 0, marginBottom: 14 }}>Schedule</h3>

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
          <Legend phases={draft} />
          {draft.map((p, i) => (
            <div key={p.phase_key + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13, gap: 10, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ marginTop: 3 }}><PhaseSwatch phase={p} /></div>
                <div>
                  <b>{p.label}</b>
                  {p.needs_review && <span style={{ fontSize: 10, color: '#8a6d1d' }}> · {p.orphaned ? 'trade no longer in breakdown' : 'duration kept from your edit — review'}</span>}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink-soft)' }}>
                      Preferred start day
                      <select value={p.preferred_start_day || ''} onChange={e => updateDraftPreferredStartDay(i, e.target.value)} style={{ fontSize: 10.5, padding: '2px 4px' }}>
                        {START_DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink-soft)' }}>
                      Weekend work
                      <select value={p.allow_weekend_work ? 'yes' : 'no'} onChange={e => updateDraftAllowWeekend(i, e.target.value === 'yes')} style={{ fontSize: 10.5, padding: '2px 4px' }}>
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </label>
                  </div>
                </div>
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

          {view === 'timeline' && <TimelineView phases={phases} onPhaseUpdate={updatePhaseDates} />}

          {view === 'list' && <Legend phases={phases} />}
          {view === 'list' && phases.map(p => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
              {editingId === p.id ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <PhaseSwatch phase={p} />
                    <b style={{ flex: 1 }}>{p.label}</b>
                    <input type="number" min="1" value={editDuration} onChange={e => setEditDuration(e.target.value)} style={{ width: 56 }} />
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>days</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                        Preferred start day
                        <select value={editPreferredStartDay} onChange={e => setEditPreferredStartDay(e.target.value)} style={{ fontSize: 11, padding: '2px 4px' }}>
                          {START_DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                        Weekend work
                        <select value={editAllowWeekend ? 'yes' : 'no'} onChange={e => setEditAllowWeekend(e.target.value === 'yes')} style={{ fontSize: 11, padding: '2px 4px' }}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => savePhaseEdit(p)}>Save</button>
                      <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ marginTop: 3 }}><PhaseSwatch phase={p} /></div>
                    <div>
                      <b>{p.label}</b>{p.source === 'manual' && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}> · edited</span>}
                      {p.needs_review && <span style={{ fontSize: 10, color: '#8a6d1d' }}> · please review</span>}
                      {p.preferred_start_day && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}> · starts {dayLabel(p.preferred_start_day)}</span>}
                      {p.allow_weekend_work && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}> · weekend OK</span>}
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtDate(p.start_date)} – {fmtDate(p.end_date)} ({p.duration_days} days)</div>
                    </div>
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

// Fixed pixel width per day column — what drag/resize below snaps to.
const DAY_WIDTH = 30;
const LABEL_WIDTH = 128;

const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// A single repeating-gradient that shades Saturday/Sunday columns,
// aligned to wherever the schedule's first day actually falls in the
// week — cheaper than rendering a div per weekend day, and it's reused
// as the background for every row plus the header.
function weekendShading(minDate) {
  const firstWeekendOffset = (6 - minDate.getDay() + 7) % 7; // days until the first Saturday
  const bandStart = firstWeekendOffset * DAY_WIDTH;
  const bandEnd = bandStart + 2 * DAY_WIDTH;
  const period = 7 * DAY_WIDTH;
  return `repeating-linear-gradient(to right, transparent 0px, transparent ${bandStart}px, var(--panel) ${bandStart}px, var(--panel) ${bandEnd}px, transparent ${bandEnd}px, transparent ${period}px)`;
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

// Day-by-day Gantt-style grid, with drag support:
// - dragging a bar's body moves it (shifts start+end together, duration
//   unchanged)
// - dragging either edge resizes it (changes duration, other edge stays
//   anchored)
// Both operate on this one phase only — no cascade to phases around it,
// and overlap is allowed, since a manual placement on a calendar is a
// deliberate choice, not something that should ripple.
function TimelineView({ phases, onPhaseUpdate }) {
  const [dragState, setDragState] = useState(null); // { phaseId, mode, startX, origStart, origEnd }
  const [previewDates, setPreviewDates] = useState(null); // { phaseId, start_date, end_date } — live feedback while dragging
  const previewRef = useRef(null);

  useEffect(() => {
    if (!dragState) return;

    function handleMove(e) {
      const deltaX = e.clientX - dragState.startX;
      const dayDelta = Math.round(deltaX / DAY_WIDTH);
      const origStart = new Date(dragState.origStart + 'T00:00:00');
      const origEnd = new Date(dragState.origEnd + 'T00:00:00');
      let newStart = origStart, newEnd = origEnd;

      if (dragState.mode === 'move') {
        newStart = addCalendarDays(origStart, dayDelta);
        newEnd = addCalendarDays(origEnd, dayDelta);
      } else if (dragState.mode === 'resize-left') {
        newStart = addCalendarDays(origStart, dayDelta);
        if (newStart > origEnd) newStart = origEnd; // never invert below 1 day
      } else if (dragState.mode === 'resize-right') {
        newEnd = addCalendarDays(origEnd, dayDelta);
        if (newEnd < origStart) newEnd = origStart;
      }

      const next = { phaseId: dragState.phaseId, start_date: toISO(newStart), end_date: toISO(newEnd) };
      previewRef.current = next;
      setPreviewDates(next);
    }

    function handleUp() {
      const result = previewRef.current;
      if (result) {
        const start = new Date(result.start_date + 'T00:00:00');
        const end = new Date(result.end_date + 'T00:00:00');
        const duration_days = Math.round((end - start) / 86400000) + 1;
        onPhaseUpdate(result.phaseId, { start_date: result.start_date, end_date: result.end_date, duration_days });
      }
      previewRef.current = null;
      setPreviewDates(null);
      setDragState(null);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, onPhaseUpdate]);

  function startDrag(phase, mode, e) {
    e.preventDefault();
    setDragState({ phaseId: phase.id, mode, startX: e.clientX, origStart: phase.start_date, origEnd: phase.end_date });
  }

  // Substitute live drag/resize positions so the grid (and its bounds)
  // reflect what you're currently doing, not just what's saved yet.
  const effectivePhases = phases.map(p =>
    (previewDates && p.id === previewDates.phaseId) ? { ...p, start_date: previewDates.start_date, end_date: previewDates.end_date } : p
  );

  const minDate = new Date(Math.min(...effectivePhases.map(p => new Date(p.start_date + 'T00:00:00'))));
  const maxDate = new Date(Math.max(...effectivePhases.map(p => new Date(p.end_date + 'T00:00:00'))));
  const totalSpan = Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1);
  const gridWidth = totalSpan * DAY_WIDTH;
  const weekendBg = weekendShading(minDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = Math.round((today - minDate) / 86400000);
  const showToday = todayOffset >= 0 && todayOffset < totalSpan;

  const days = Array.from({ length: totalSpan }, (_, i) => addCalendarDays(minDate, i));

  return (
    <div style={{ marginBottom: 8 }}>
      <Legend phases={phases} />
      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
        Drag a bar to move it, or its edges to resize — phases can overlap here, and moving one doesn't shift the others.
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        <div style={{ width: LABEL_WIDTH + gridWidth }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 2, borderBottom: '1px solid var(--line)' }} />
            <div style={{ width: gridWidth, flexShrink: 0, display: 'flex', background: weekendBg, borderBottom: '1px solid var(--line)' }}>
              {days.map((d, i) => (
                <div key={i} style={{ width: DAY_WIDTH, flexShrink: 0, textAlign: 'center', padding: '4px 0' }}>
                  <div style={{ fontSize: 8.5, color: 'var(--ink-soft)' }}>{dateLabel(d)}</div>
                  <div style={{ fontSize: 10, fontWeight: 600 }}>{DOW_LETTERS[d.getDay()]}</div>
                </div>
              ))}
            </div>
          </div>

          {effectivePhases.map(p => {
            const start = new Date(p.start_date + 'T00:00:00');
            const end = new Date(p.end_date + 'T00:00:00');
            const offsetDays = Math.round((start - minDate) / 86400000);
            const spanDays = Math.round((end - start) / 86400000) + 1;
            const isDragging = dragState?.phaseId === p.id;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 1, padding: '6px 8px 6px 0', fontSize: 10.5, lineHeight: 1.25 }}>
                  {p.label}
                  <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{p.duration_days}d</div>
                </div>
                <div style={{ width: gridWidth, flexShrink: 0, position: 'relative', height: 32, background: weekendBg }}>
                  {showToday && (
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: todayOffset * DAY_WIDTH, width: 2, background: 'var(--accent)' }} />
                  )}
                  <div
                    title={`${fmtDate(p.start_date)} – ${fmtDate(p.end_date)} · drag to move, edges to resize`}
                    onPointerDown={e => startDrag(p, 'move', e)}
                    style={{
                      position: 'absolute', top: 5, bottom: 5,
                      left: offsetDays * DAY_WIDTH + 2, width: Math.max(spanDays * DAY_WIDTH - 4, DAY_WIDTH - 4),
                      borderRadius: 4,
                      background: p.needs_review ? 'var(--gold)' : phaseBackground(p),
                      opacity: isDragging ? 0.75 : 1,
                      boxShadow: isDragging ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: isDragging && dragState.mode === 'move' ? 'grabbing' : 'grab',
                      touchAction: 'none',
                    }}
                  >
                    <div
                      onPointerDown={e => { e.stopPropagation(); startDrag(p, 'resize-left', e); }}
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', touchAction: 'none' }}
                    />
                    <div
                      onPointerDown={e => { e.stopPropagation(); startDrag(p, 'resize-right', e); }}
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', touchAction: 'none' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {showToday && (
        <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', marginRight: 5, verticalAlign: 'middle' }} />
          Today
        </div>
      )}
    </div>
  );
}
