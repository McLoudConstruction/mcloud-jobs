'use client';
import { useState } from 'react';

export const LOSS_REASONS = [
  'Went with another contractor',
  'Price too high',
  'Budget or funding fell through',
  'Project postponed',
  'Project canceled or scope changed',
  'Not responding',
  'Outside our service area',
  'Not a good fit for our work',
];
const OTHER = '__other__';

// Reason-for-loss picker: a dropdown of common reasons plus Other, which
// opens a text box. `onChange` always receives the final text to store
// (the chosen reason, the typed text for Other, or '' when nothing is
// chosen yet). Mount it fresh each time (conditional render) to reset it.
export default function LossReasonPicker({ value, onChange }) {
  const [choice, setChoice] = useState(() => {
    if (!value) return '';
    return LOSS_REASONS.includes(value) ? value : OTHER;
  });
  const [other, setOther] = useState(() => (value && !LOSS_REASONS.includes(value) ? value : ''));

  function pick(next) {
    setChoice(next);
    onChange(next === OTHER ? other.trim() : next);
  }

  return (
    <div>
      <select value={choice} onChange={e => pick(e.target.value)} aria-label="Reason for loss">
        <option value="">Select a reason…</option>
        {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        <option value={OTHER}>Other…</option>
      </select>
      {choice === OTHER && (
        <textarea
          style={{ marginTop: 8 }}
          autoFocus
          value={other}
          onChange={e => { setOther(e.target.value); onChange(e.target.value.trim()); }}
          placeholder="Describe the reason…"
        />
      )}
    </div>
  );
}
