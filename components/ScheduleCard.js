'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { recomputeSequentialDates, countWorkableDays, splitAtWeekends } from '../lib/scheduleDates';
import { phaseBackground, tradesForPhase } from '../lib/tradeColors';
import { defaultWorkLocationForPhase } from '../lib/tradeWeather';
import { SERVICES_OFFERED, SCHEDULE_PHASE_TYPES } from '../lib/constants';

const WORK_LOCATION_OPTIONS = [
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'mixed', label: 'Mixed' },
];

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

// One computed status per outdoor phase, so exactly one line renders —
// no risk of two conditions both matching (or, as happened before this
// was centralized, a phase with no trade at all — possible now that
// "Add line item" allows one — falling through every check and getting
// a false "no conflicts found" it was never actually checked for).
function WeatherStatusLine({ phase, flag, noRule, checkedThrough }) {
  if (flag) {
    return (
      <div style={{ fontSize: 10.5, color: '#a13f3f', marginTop: 3, maxWidth: 420 }}>
        ⚠ Weather risk on {fmtDate(flag.date)}: {flag.reasons.join(' ')}
      </div>
    );
  }
  if (!phase.trade) {
    return (
      <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3, fontStyle: 'italic' }}>
        No trade selected — not being checked for weather.
      </div>
    );
  }
  if (noRule) {
    return (
      <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3, fontStyle: 'italic' }}>
        No weather thresholds defined for {phase.trade} yet — not being checked.
      </div>
    );
  }
  if (checkedThrough && phase.start_date > checkedThrough) {
    return (
      <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3, fontStyle: 'italic' }}>
        Weather not checkable yet — forecast only covers through {fmtDate(checkedThrough)}.
      </div>
    );
  }
  if (checkedThrough && phase.start_date <= checkedThrough) {
    return (
      <div style={{ fontSize: 10, color: '#4a8a5f', marginTop: 3 }}>
        ✓ No weather conflicts found for this trade ({phase.trade}).
      </div>
    );
  }
  return null;
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
  const [editWorkLocation, setEditWorkLocation] = useState('indoor');
  const [view, setView] = useState('list'); // 'list' | 'timeline'
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhase, setNewPhase] = useState({ label: '', trade: '', start_date: '', duration_days: 1, preferred_start_day: '', allow_weekend_work: false, work_location: 'indoor' });
  const [weatherFlags, setWeatherFlags] = useState({}); // phase_id -> { date, reasons }
  const [weatherCheckedThrough, setWeatherCheckedThrough] = useState(null); // last date the forecast covers
  const [weatherNoRuleIds, setWeatherNoRuleIds] = useState([]); // phase ids whose trade has no threshold row at all

  // A draft (generated but not yet published) now lives as its own real
  // job_phases rows, status: 'draft', persisted the moment Generate
  // Schedule runs — not just in local state — so it survives navigating
  // away. This one query loads both: published rows become `phases`,
  // draft rows (if any are waiting) become `draft`, which means a staff
  // member who left mid-review sees their draft again on return instead
  // of it being gone.
  const loadPhases = useCallback(async () => {
    const { data } = await supabase.from('job_phases').select('*').eq('job_id', jobId).order('sort_order', { ascending: true });
    if (!data) return;
    setPhases(data.filter(p => p.status !== 'draft'));
    const draftRows = data.filter(p => p.status === 'draft');
    setDraft(prev => {
      if (draftRows.length === 0) return null;
      // Don't stomp mid-edit local state (e.g. a duration field mid-
      // keystroke, not yet blurred/persisted) with a realtime-triggered
      // reload of the same rows — only replace when the set of ids
      // actually changed (a fresh generate, a remove, a different tab).
      if (prev && prev.length === draftRows.length && prev.every(p => draftRows.some(d => d.id === p.id))) {
        return prev;
      }
      return draftRows;
    });
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

  // Re-checked whenever the phase list changes (edits, regeneration, drag)
  // so a flag clears itself once a phase is moved out of a bad weather
  // window. One Call 4.0's timeline only covers ~8 days out, so phases
  // further in the future simply won't appear in `flags` yet — that's
  // "not yet knowable," not "clear," which is why weatherCheckedThrough
  // is tracked separately and shown on any phase past it (see the phase
  // row below) rather than just staying silent the same way a genuinely
  // clear phase would.
  useEffect(() => {
    if (phases.length === 0) { setWeatherFlags({}); setWeatherCheckedThrough(null); return; }
    let mounted = true;
    fetch(`/api/jobs/${jobId}/weather-flags`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        if (data.flags) setWeatherFlags(data.flags);
        setWeatherCheckedThrough(data.checkedThrough || null);
        setWeatherNoRuleIds(data.noRulePhaseIds || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [jobId, phases]);

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
      // Prefill each phase's Work Location from a per-trade default (see
      // lib/tradeWeather.js) so Stachys only has to correct exceptions,
      // not set all of them by hand.
      const withDefaults = data.phases.map(p => ({ ...p, work_location: defaultWorkLocationForPhase(p, job?.work_location) }));
      const computed = phases.length > 0 ? mergeWithExisting(withDefaults, phases, startDate) : withDefaults;

      // Persist the draft immediately as status:'draft' rows, rather than
      // holding it only in local component state — that's what used to
      // make it vanish if you navigated away before clicking Confirm.
      // Replaces any earlier unpublished draft for this job first.
      await supabase.from('job_phases').delete().eq('job_id', jobId).eq('status', 'draft');
      const { data: inserted, error: insertError } = await supabase
        .from('job_phases')
        .insert(computed.map(p => ({ ...p, job_id: jobId, status: 'draft' })))
        .select();
      if (insertError) throw insertError;
      setDraft(inserted.sort((a, b) => a.sort_order - b.sort_order));
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
        work_location: manual.work_location || p.work_location,
      };
    });

    const orphaned = existingPhases
      .filter(p => p.source === 'manual' && p.phase_key !== 'custom' && !freshKeys.has(p.phase_key))
      .map(p => ({
        phase_key: p.phase_key, label: p.label, trade: p.trade, duration_days: p.duration_days,
        source: 'manual', needs_review: true, orphaned: true,
        preferred_start_day: p.preferred_start_day, allow_weekend_work: p.allow_weekend_work,
        work_location: p.work_location,
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

  // Persists every row in a just-edited draft back to its already-inserted
  // job_phases row (draft rows get a real id the moment Generate Schedule
  // runs — see generate() above), so a duration/day/location tweak isn't
  // lost either, same as the draft itself no longer being lost.
  async function persistDraftRows(rows) {
    await Promise.all(rows.filter(p => p.id).map(p => supabase.from('job_phases').update({
      duration_days: p.duration_days,
      start_date: p.start_date,
      end_date: p.end_date,
      preferred_start_day: p.preferred_start_day || null,
      allow_weekend_work: p.allow_weekend_work,
      work_location: p.work_location,
    }).eq('id', p.id)));
  }

  // Clamps to a valid integer once the field loses focus, so it never
  // stays blank or invalid after you click away.
  function finalizeDraftDuration(index) {
    const clamped = Math.max(1, Math.round(Number(draft[index].duration_days)) || 1);
    const updated = draft.map((p, i) => i === index ? { ...p, duration_days: clamped } : p);
    const recomputed = recomputeSequentialDates(updated, startDate);
    setDraft(recomputed);
    persistDraftRows(recomputed);
  }

  function updateDraftPreferredStartDay(index, value) {
    const updated = draft.map((p, i) => i === index ? { ...p, preferred_start_day: value || null } : p);
    const recomputed = recomputeSequentialDates(updated, startDate);
    setDraft(recomputed);
    persistDraftRows(recomputed);
  }

  function updateDraftAllowWeekend(index, allow) {
    const updated = draft.map((p, i) => i === index ? { ...p, allow_weekend_work: allow } : p);
    const recomputed = recomputeSequentialDates(updated, startDate);
    setDraft(recomputed);
    persistDraftRows(recomputed);
  }

  function updateDraftWorkLocation(index, value) {
    const updated = draft.map((p, i) => i === index ? { ...p, work_location: value } : p);
    setDraft(updated);
    persistDraftRows(updated);
  }

  // Lets a phase representing one trade in a concurrent group (e.g.
  // Framing / Concrete & Foundation / Masonry, which now schedule as
  // separate bars in the same window — see lib/scheduleTemplate.js) be
  // dropped individually when this job doesn't actually need it, without
  // losing the other phases in that group.
  async function removeDraftPhase(index) {
    const removed = draft[index];
    const remaining = draft.filter((_, i) => i !== index);
    setDraft(remaining.length > 0 ? remaining : null);
    if (removed.id) {
      await supabase.from('job_phases').delete().eq('id', removed.id);
    }
  }

  // The draft's rows are already persisted (status: 'draft', see
  // generate() and the row-level editors above) — publishing just means
  // making them the live schedule: clear whatever was published before,
  // flip the draft rows over to status: 'published'.
  async function publishDraft() {
    setSaving(true);
    setError('');
    try {
      // Belt-and-suspenders: normalize durations even if Publish was
      // clicked while a field was still mid-edit (e.g. via Enter key
      // without a blur), so an empty/invalid value never reaches the DB.
      const cleanDraft = recomputeSequentialDates(
        draft.map(p => ({ ...p, duration_days: Math.max(1, Math.round(Number(p.duration_days)) || 1) })),
        startDate
      );
      await persistDraftRows(cleanDraft);

      await supabase.from('job_phases').delete().eq('job_id', jobId).eq('status', 'published');
      const { error: publishError } = await supabase
        .from('job_phases')
        .update({ status: 'published' })
        .eq('job_id', jobId)
        .eq('status', 'draft');
      if (publishError) throw publishError;
      await supabase.from('jobs').update({ schedule_stale_at: null }).eq('id', jobId);
      setDraft(null);
      await loadPhases();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Discarding the draft means actually deleting its rows too — otherwise
  // "Cancel" would leave an orphaned draft sitting in the table that
  // reappears (via loadPhases) the next time this page loads.
  async function cancelDraft() {
    await supabase.from('job_phases').delete().eq('job_id', jobId).eq('status', 'draft');
    setDraft(null);
    setWarning('');
  }

  async function dismissStale() {
    await supabase.from('jobs').update({ schedule_stale_at: null }).eq('id', jobId);
  }

  function startEditPhase(p) {
    setEditingId(p.id);
    setEditDuration(p.duration_days);
    setEditPreferredStartDay(p.preferred_start_day || '');
    setEditAllowWeekend(!!p.allow_weekend_work);
    setEditWorkLocation(p.work_location || 'indoor');
  }

  async function savePhaseEdit(phase) {
    // Deliberately independent of every other phase — no cascade, same
    // philosophy as the Timeline view's drag/resize below. Editing one
    // phase's duration used to rebase every phase scheduled after it,
    // which meant moving one phase up because a trade became available
    // early also silently dragged the next several phases along with
    // it. Only this phase's own start date is used as the anchor for
    // its own new end date.
    const recomputed = recomputeSequentialDates(
      [{
        ...phase,
        duration_days: Math.max(1, Number(editDuration) || 1),
        preferred_start_day: editPreferredStartDay || null,
        allow_weekend_work: editAllowWeekend,
      }],
      phase.start_date
    )[0];

    await supabase.from('job_phases').update({
      duration_days: recomputed.duration_days,
      start_date: recomputed.start_date,
      end_date: recomputed.end_date,
      preferred_start_day: recomputed.preferred_start_day,
      allow_weekend_work: recomputed.allow_weekend_work,
      work_location: editWorkLocation,
      source: 'manual',
      needs_review: false,
    }).eq('id', phase.id);

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

  // Adds a standalone line item to an already-generated schedule — e.g.
  // scope that came up after the fact, or a trade the AI breakdown
  // didn't cover. Uses phase_key: 'custom' so regenerating never treats
  // it as orphaned (see mergeWithExisting above) and picks its own start
  // date directly rather than being slotted into the existing sequence,
  // consistent with every other date edit here being independent of the
  // rest of the schedule.
  async function saveNewPhase() {
    if (!newPhase.label.trim()) { setError('Give the new line item a name.'); return; }
    if (!newPhase.start_date) { setError('Pick a start date for the new line item.'); return; }
    setError('');

    const computed = recomputeSequentialDates(
      [{ ...newPhase, duration_days: Math.max(1, Number(newPhase.duration_days) || 1) }],
      newPhase.start_date
    )[0];
    const maxSortOrder = phases.length > 0 ? Math.max(...phases.map(p => p.sort_order)) : -1;

    const { error: insertError } = await supabase.from('job_phases').insert({
      job_id: jobId,
      phase_key: 'custom',
      label: newPhase.label.trim(),
      trade: newPhase.trade || null,
      duration_days: computed.duration_days,
      start_date: computed.start_date,
      end_date: computed.end_date,
      preferred_start_day: computed.preferred_start_day || null,
      allow_weekend_work: computed.allow_weekend_work,
      work_location: newPhase.work_location,
      source: 'manual',
      needs_review: false,
      sort_order: maxSortOrder + 1,
    });
    if (insertError) { setError(insertError.message); return; }

    setNewPhase({ label: '', trade: '', start_date: '', duration_days: 1, preferred_start_day: '', allow_weekend_work: false, work_location: 'indoor' });
    setAddingPhase(false);
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
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Review before publishing — saved as a draft, safe to leave and come back</div>

          <div className="section-actions" style={{ marginTop: 0, marginBottom: 12 }}>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`} onClick={() => setView('list')}>List</button>
            <button className={`btn btn-sm ${view === 'timeline' ? 'btn-primary' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
          </div>

          {view === 'timeline' && <TimelineView phases={draft} onPhaseUpdate={updatePhaseDates} />}

          {view === 'list' && <Legend phases={draft} />}
          {view === 'list' && draft.map((p, i) => (
            <div key={p.id || p.phase_key + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13, gap: 10, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ marginTop: 3 }}><PhaseSwatch phase={p} /></div>
                <div>
                  <b>{p.label}</b>
                  {p.needs_review && <span style={{ fontSize: 10, color: '#8a6d1d' }}> · {p.orphaned ? 'trade no longer in breakdown' : 'duration kept from your edit — review'}</span>}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
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
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink-soft)' }}>
                      Work location
                      <select value={p.work_location || 'indoor'} onChange={e => updateDraftWorkLocation(i, e.target.value)} style={{ fontSize: 10.5, padding: '2px 4px' }}>
                        {WORK_LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input type="number" min="1" value={p.duration_days} onChange={e => updateDraftDuration(i, e.target.value)} onBlur={() => finalizeDraftDuration(i)} style={{ width: 56 }} />
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>days</span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  title="Remove this phase — e.g. a trade this job doesn't actually need"
                  onClick={() => removeDraftPhase(i)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={publishDraft} disabled={saving}>{saving ? 'Publishing…' : 'Publish Schedule'}</button>
            <button className="btn btn-sm" onClick={cancelDraft}>Cancel</button>
          </div>
        </div>
      )}

      {!draft && phases.length > 0 && (
        <div>
          {totalDays && (
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
              {fmtDate(phases[0].start_date)} – {fmtDate(phases[phases.length - 1].end_date)} · {totalDays} calendar days
            </div>
          )}

          <div className="section-actions" style={{ marginTop: 0, marginBottom: 12 }}>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`} onClick={() => setView('list')}>List</button>
            <button className={`btn btn-sm ${view === 'timeline' ? 'btn-primary' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
          </div>

          {view === 'timeline' && <TimelineView phases={phases} onPhaseUpdate={updatePhaseDates} />}

          {view === 'list' && <Legend phases={phases} />}
          {view === 'list' && (
            <div className="schedule-table">
              <div className="schedule-header-row">
                <div>Phase</div>
                <div>Start Date</div>
                <div>End Date</div>
                <div>Weather</div>
                <div></div>
              </div>
              {phases.map(p => (
                editingId === p.id ? (
                  <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 14, background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PhaseSwatch phase={p} />
                      <b style={{ flex: 1 }}>{p.label}</b>
                      <input type="number" min="1" value={editDuration} onChange={e => setEditDuration(e.target.value)} style={{ width: 56 }} />
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>days</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}>
                          Preferred start day
                          <select value={editPreferredStartDay} onChange={e => setEditPreferredStartDay(e.target.value)} style={{ fontSize: 12, padding: '2px 4px' }}>
                            {START_DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}>
                          Weekend work
                          <select value={editAllowWeekend ? 'yes' : 'no'} onChange={e => setEditAllowWeekend(e.target.value === 'yes')} style={{ fontSize: 12, padding: '2px 4px' }}>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}>
                          Work location
                          <select value={editWorkLocation} onChange={e => setEditWorkLocation(e.target.value)} style={{ fontSize: 12, padding: '2px 4px' }}>
                            {WORK_LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  <div key={p.id} className="schedule-row" style={{ background: p.needs_review ? 'var(--bg-warning, #fff8e6)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ marginTop: 3 }}><PhaseSwatch phase={p} /></div>
                      <div>
                        <b>{p.label}</b>{p.source === 'manual' && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · edited</span>}
                        {p.needs_review && <span style={{ fontSize: 11, color: '#8a6d1d' }}> · please review</span>}
                        {p.preferred_start_day && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · starts {dayLabel(p.preferred_start_day)}</span>}
                        {p.allow_weekend_work && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · weekend OK</span>}
                        {p.work_location && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · {p.work_location === 'outdoor' ? 'Outdoor' : p.work_location === 'mixed' ? 'Mixed' : 'Indoor'}</span>}
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.duration_days} days</div>
                      </div>
                    </div>
                    <div>{fmtDate(p.start_date)}</div>
                    <div>{fmtDate(p.end_date)}</div>
                    <div>
                      {p.work_location === 'outdoor' || p.work_location === 'mixed' ? (
                        <WeatherStatusLine
                          phase={p}
                          flag={weatherFlags[p.id]}
                          noRule={weatherNoRuleIds.includes(p.id)}
                          checkedThrough={weatherCheckedThrough}
                        />
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Indoor — not checked</span>
                      )}
                    </div>
                    <div><button className="btn btn-sm" onClick={() => startEditPhase(p)}>Edit</button></div>
                  </div>
                )
              ))}
            </div>
          )}

          {view === 'list' && addingPhase && (
            <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Name</label>
                  <input type="text" value={newPhase.label} onChange={e => setNewPhase({ ...newPhase, label: e.target.value })} placeholder="e.g. Fence repair" style={{ width: 180 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Trade</label>
                  <select value={newPhase.trade} onChange={e => setNewPhase({ ...newPhase, trade: e.target.value })} style={{ width: 150 }}>
                    <option value="">No specific trade</option>
                    <optgroup label="Trades">
                      {SERVICES_OFFERED.map(t => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                    {/* Not billable trades — delays, inspections, the
                        punch list/walkthrough, admin time — but real
                        schedule phases with their own color. */}
                    <optgroup label="Other">
                      {SCHEDULE_PHASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Start date</label>
                  <input type="date" value={newPhase.start_date} onChange={e => setNewPhase({ ...newPhase, start_date: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Duration</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="1" value={newPhase.duration_days} onChange={e => setNewPhase({ ...newPhase, duration_days: e.target.value })} style={{ width: 56 }} />
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>days</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Weekend work</label>
                  <select value={newPhase.allow_weekend_work ? 'yes' : 'no'} onChange={e => setNewPhase({ ...newPhase, allow_weekend_work: e.target.value === 'yes' })}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Work location</label>
                  <select value={newPhase.work_location} onChange={e => setNewPhase({ ...newPhase, work_location: e.target.value })}>
                    {WORK_LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button className="btn btn-sm btn-primary" onClick={saveNewPhase}>Add to schedule</button>
                <button className="btn btn-sm" onClick={() => { setAddingPhase(false); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}

          <div className="section-actions">
            {view === 'list' && !addingPhase && (
              <button className="btn btn-sm" onClick={() => setAddingPhase(true)}>+ Add line item</button>
            )}
            <button className="btn btn-sm" onClick={() => { setStartDate(phases[0].start_date); generate(); }}>Regenerate</button>
            <button className="btn btn-sm btn-danger" onClick={removeAllPhases}>Remove schedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Fixed pixel width per day column on mobile, and the desktop fallback
// before its container has been measured. On desktop, TimelineView
// computes an actual day width from the card's available space instead
// — see MAX_FIT_DAYS below.
const DAY_WIDTH = 30;
const LABEL_WIDTH = 128;
// Desktop only: a schedule up to this many days stretches to fill the
// card's full width, so nothing needs a scrollbar just to see the whole
// thing at a glance. Beyond this, day width holds steady at whatever a
// full month would have used, and the rest scrolls — stretching further
// would make individual days illegibly thin instead of just scrolling.
const MAX_FIT_DAYS = 31;
const MOBILE_BREAKPOINT = 767;

const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// A single repeating-gradient that shades Saturday/Sunday columns,
// aligned to wherever the schedule's first day actually falls in the
// week — cheaper than rendering a div per weekend day, and it's reused
// as the background for every row plus the header. dayWidth is now a
// parameter rather than the fixed DAY_WIDTH constant, since desktop
// computes its own.
function weekendShading(minDate, dayWidth) {
  const firstWeekendOffset = (6 - minDate.getDay() + 7) % 7; // days until the first Saturday
  const bandStart = firstWeekendOffset * dayWidth;
  const bandEnd = bandStart + 2 * dayWidth;
  const period = 7 * dayWidth;
  return `repeating-linear-gradient(to right, transparent 0px, transparent ${bandStart}px, color-mix(in srgb, var(--panel) 55%, var(--ink-soft) 20%) ${bandStart}px, color-mix(in srgb, var(--panel) 55%, var(--ink-soft) 20%) ${bandEnd}px, transparent ${bandEnd}px, transparent ${period}px)`;
}

// A thin vertical line at the start of every day column, so a bar's edges
// can be read against exactly which day they fall on instead of only
// against the header's date labels above.
function gridlines(dayWidth) {
  return `repeating-linear-gradient(to right, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${dayWidth}px)`;
}

// Combines the day gridlines (drawn on top) with the weekend shading
// (underneath) into one background value — both are pure gradients with
// transparent everywhere they don't apply, so they layer cleanly.
function gridBackground(minDate, dayWidth) {
  return `${gridlines(dayWidth)}, ${weekendShading(minDate, dayWidth)}`;
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
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const dayWidthRef = useRef(DAY_WIDTH);

  useEffect(() => {
    function checkMobile() { setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT); }
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dragState) return;

    function handleMove(e) {
      const deltaX = e.clientX - dragState.startX;
      const dayDelta = Math.round(deltaX / dayWidthRef.current);
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
        const duration_days = countWorkableDays(result.start_date, result.end_date, dragState.allowWeekend);
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
    setDragState({ phaseId: phase.id, mode, startX: e.clientX, origStart: phase.start_date, origEnd: phase.end_date, allowWeekend: !!phase.allow_weekend_work });
  }

  // Substitute live drag/resize positions so the grid (and its bounds)
  // reflect what you're currently doing, not just what's saved yet.
  const effectivePhases = phases.map(p =>
    (previewDates && p.id === previewDates.phaseId) ? { ...p, start_date: previewDates.start_date, end_date: previewDates.end_date } : p
  );

  const minDate = new Date(Math.min(...effectivePhases.map(p => new Date(p.start_date + 'T00:00:00'))));
  const maxDate = new Date(Math.max(...effectivePhases.map(p => new Date(p.end_date + 'T00:00:00'))));
  const totalSpan = Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1);

  let dayWidth = DAY_WIDTH;
  if (!isMobile && containerWidth > 0) {
    const availableWidth = containerWidth - LABEL_WIDTH;
    const fitSpan = Math.min(totalSpan, MAX_FIT_DAYS);
    dayWidth = Math.max(20, availableWidth / fitSpan);
  }
  dayWidthRef.current = dayWidth;

  const gridWidth = totalSpan * dayWidth;
  const weekendBg = gridBackground(minDate, dayWidth);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = Math.round((today - minDate) / 86400000);
  const showToday = todayOffset >= 0 && todayOffset < totalSpan;

  const days = Array.from({ length: totalSpan }, (_, i) => addCalendarDays(minDate, i));

  return (
    <div style={{ marginBottom: 8 }}>
      <Legend phases={phases} />
      <div ref={containerRef} style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        <div style={{ width: LABEL_WIDTH + gridWidth }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 2, borderBottom: '1px solid var(--line)' }} />
            <div style={{ width: gridWidth, flexShrink: 0, display: 'flex', background: weekendBg, borderBottom: '1px solid var(--line)' }}>
              {days.map((d, i) => (
                <div key={i} style={{ width: dayWidth, flexShrink: 0, textAlign: 'center', padding: '4px 0' }} className={showToday && i === todayOffset ? 'schedule-today-col' : ''}>
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
            const segments = splitAtWeekends(p.start_date, p.end_date, p.allow_weekend_work);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 1, padding: '6px 8px 6px 10px', fontSize: 10.5, lineHeight: 1.25 }}>
                  {p.label}
                  <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{p.duration_days}d</div>
                </div>
                <div style={{ width: gridWidth, flexShrink: 0, position: 'relative', height: 32, background: weekendBg }}>
                  {showToday && (
                    <div className="schedule-today-row" style={{ position: 'absolute', top: 0, bottom: 0, left: todayOffset * dayWidth, width: dayWidth }} />
                  )}
                  {/* Transparent hit area spans the full range for move/resize
                      dragging — the visible color lives in the segments below,
                      not here, so a weekend gap between segments is never
                      covered by an invisible-but-still-there colored block. */}
                  <div
                    title={`${fmtDate(p.start_date)} – ${fmtDate(p.end_date)} · drag to move, edges to resize${segments.length > 1 ? ' · weekend skipped, not worked' : ''}`}
                    onPointerDown={e => startDrag(p, 'move', e)}
                    style={{
                      position: 'absolute', top: 5, bottom: 5,
                      left: offsetDays * dayWidth + 2, width: Math.max(spanDays * dayWidth - 4, dayWidth - 4),
                      opacity: isDragging ? 0.75 : 1,
                      cursor: isDragging && dragState.mode === 'move' ? 'grabbing' : 'grab',
                      touchAction: 'none',
                    }}
                  >
                    {segments.map((seg, si) => {
                      const segStart = new Date(seg.start + 'T00:00:00');
                      const segEnd = new Date(seg.end + 'T00:00:00');
                      const segOffset = Math.round((segStart - start) / 86400000);
                      const segSpan = Math.round((segEnd - segStart) / 86400000) + 1;
                      return (
                        <div
                          key={si}
                          style={{
                            position: 'absolute', top: 0, bottom: 0,
                            left: segOffset * dayWidth, width: segSpan * dayWidth - 2,
                            borderRadius: 4,
                            background: p.needs_review ? 'var(--gold)' : phaseBackground(p),
                            boxShadow: isDragging ? '0 0 0 2px var(--accent)' : 'none',
                          }}
                        />
                      );
                    })}
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
