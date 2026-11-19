'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useStaffAuth } from '../lib/staffAuthContext';
import { fmtMoney } from '../lib/format';

// Flag on the job when its contract price is under the residential / commercial
// minimum. Anyone can see it; only an owner can override it (the database enforces that too).
export default function ContractMinimumBanner({ job, status, onJobPatch }) {
  const { role, fullName, email } = useStaffAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!status?.show) return null;
  const isOwner = role === 'owner';

  async function apply(patch) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('jobs').update(patch).eq('id', job.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onJobPatch(patch);
    setOpen(false);
    setNote('');
  }

  const overrideNow = () => apply({
    min_override_at: new Date().toISOString(),
    min_override_by: fullName || email || 'Owner',
    min_override_price: status.price,
    min_override_note: note.trim() || null,
  });
  const clearOverride = () => apply({ min_override_at: null, min_override_by: null, min_override_price: null, min_override_note: null });

  // Tinted overlays + theme text color so it reads in both light and dark mode.
  const box = { fontSize: 13, padding: '12px 16px', borderRadius: 6, marginBottom: 14, border: '1px solid', color: 'var(--ink)' };

  if (status.overridden && job.min_override_at) {
    return (
      <div style={{ ...box, background: 'rgba(155, 119, 61, 0.14)', borderColor: '#9b773d' }}>
        <b>Under the {status.kind} minimum — overridden</b> by {job.min_override_by || 'an owner'} on {new Date(job.min_override_at).toLocaleDateString('en-US')}
        {' '}(minimum {fmtMoney(status.minimum)}, approved at {fmtMoney(job.min_override_price)}).
        {job.min_override_note && <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>Reason: {job.min_override_note}</div>}
        {isOwner && status.needsOverride === false && ['new', 'inspected', 'proposal_delivered'].includes(job.stage) && (
          <div style={{ marginTop: 6 }}><button className="btn btn-sm" disabled={busy} onClick={clearOverride}>Remove override</button></div>
        )}
        {error && <div className="error-text">{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...box, background: 'rgba(192, 82, 79, 0.14)', borderColor: '#c0524f' }}>
      <b>Under the {status.kind} contract minimum.</b>{' '}
      {status.price > 0 ? `This ${status.measure} is ${fmtMoney(status.price)}` : 'No contract price is entered'}; the minimum is {fmtMoney(status.minimum)}.
      {job.below_minimum_flagged_at && ' The customer has signed, but the job was held here.'}
      {' '}It can&apos;t be approved without an owner override.
      {isOwner ? (
        open ? (
          <div style={{ marginTop: 8 }}>
            <label>Reason for override (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. repeat customer, adjacent to another job" />
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={overrideNow}>{busy ? 'Saving…' : 'Confirm override'}</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => setOpen(true)}>Override minimum</button></div>
        )
      ) : (
        <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>Ask an owner to override it from this job.</div>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
