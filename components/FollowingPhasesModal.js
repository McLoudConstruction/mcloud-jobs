'use client';
import { useState, useMemo } from 'react';
import PopupModal from './PopupModal';
import { applyCascade } from '../lib/scheduleCascade';

function fmt(v) {
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Shown after a phase's finish moves (drag, edit, delay). Lists the phases
// after it with checkboxes and shifts only the ones left ticked. Phases
// linked to the moved phase start ticked; skipping moves nothing.
//
// props:
//   anchor      the phase that moved (already saved)
//   delta       working days its finish moved (signed)
//   candidates  from followerCandidates()
//   onApply(selectedIds, shiftedRows)  async; caller persists shiftedRows
//   onSkip()
export default function FollowingPhasesModal({ anchor, delta, candidates, onApply, onSkip }) {
  const [picked, setPicked] = useState(() => new Set(candidates.filter(c => c.checked).map(c => c.phase.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shifted = useMemo(() => {
    const rows = applyCascade(candidates.map(c => c.phase), [...picked], delta);
    return Object.fromEntries(rows.map(r => [r.id, r]));
  }, [candidates, picked, delta]);

  const days = Math.abs(delta);
  const dir = delta > 0 ? 'later' : 'earlier';

  function toggle(id) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      await onApply([...picked], Object.values(shifted));
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  }

  return (
    <PopupModal open onClose={busy ? () => {} : onSkip} maxWidth={520}>
      <h3 style={{ marginTop: 0 }}>Move the phases after it?</h3>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
        <b>{anchor.label}</b> now finishes {fmt(anchor.end_date)}, {days} working day{days === 1 ? '' : 's'} {dir}. Tick the phases that should move {days} working day{days === 1 ? '' : 's'} {dir} with it. Anything left unticked stays where it is.
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
        <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set(candidates.map(c => c.phase.id)))}>Select all</button>
        <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set())}>Select none</button>
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 6, maxHeight: 320, overflowY: 'auto' }}>
        {candidates.map(c => {
          const p = c.phase;
          const on = picked.has(p.id);
          const next = shifted[p.id];
          return (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderBottom: '1px solid var(--line)', fontWeight: 400, cursor: 'pointer', background: on ? 'var(--panel)' : undefined }}>
              <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={on} onChange={() => toggle(p.id)} />
              <span style={{ flex: 1, fontSize: 13 }}>
                <b>{p.label}</b>{c.linked && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}> · linked</span>}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>
                  {fmt(p.start_date)} – {fmt(p.end_date)}{on && next ? `  →  ${fmt(next.start_date)} – ${fmt(next.end_date)}` : ''}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-sm" onClick={onSkip} disabled={busy}>Leave the rest as is</button>
        <button type="button" className="btn btn-sm btn-primary" onClick={apply} disabled={busy || picked.size === 0}>
          {busy ? 'Moving…' : `Move ${picked.size} phase${picked.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </PopupModal>
  );
}
