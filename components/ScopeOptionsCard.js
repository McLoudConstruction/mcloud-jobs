'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return 'Not priced yet';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Multi-option mode: two or more ENTIRELY SEPARATE scopes of work for the
// same project (e.g. "Option A: patch repair" vs "Option B: full
// replacement"), each with its own full line-by-line scope. Only one
// moves forward — the customer picks interactively on the estimate
// document. Rendered by ScopeCard in place of the single scope editor
// when job.estimate_mode === 'multi'.
//
// Price is deliberately NOT typed here — same as the job's single scope,
// each option is priced from a full materials/subcontractor cost
// build-up on the Cost tab (option switcher there). This card just shows
// the option's current computed price and links over to price it.
export default function ScopeOptionsCard({ job, jobId }) {
  const [options, setOptions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_scope_options').select('*').eq('job_id', jobId).order('sort_order');
    setOptions(data || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`estimate-scope-options-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_scope_options', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  const isLocked = !!job.estimate_groups_submitted_at;

  async function addOption() {
    const label = window.prompt('Name this option (e.g. "Option A: Patch Repair"):');
    if (!label || !label.trim()) return;
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('estimate_scope_options').insert({
      job_id: jobId,
      label: label.trim(),
      sort_order: options.length,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    await load();
  }

  async function updateOption(id, patch) {
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('estimate_scope_options').update(patch).eq('id', id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    await load();
  }

  async function deleteOption(o) {
    if (!window.confirm(`Delete "${o.label}"? This can't be undone.`)) return;
    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase.from('estimate_scope_options').delete().eq('id', o.id);
    setBusy(false);
    if (deleteError) { setError(deleteError.message); return; }
    await load();
  }

  async function moveOption(o, dir) {
    const ordered = [...options].sort((a, b) => a.sort_order - b.sort_order);
    const idx = ordered.findIndex(x => x.id === o.id);
    const swapWith = ordered[idx + dir];
    if (!swapWith) return;
    setBusy(true);
    await Promise.all([
      supabase.from('estimate_scope_options').update({ sort_order: swapWith.sort_order }).eq('id', o.id),
      supabase.from('estimate_scope_options').update({ sort_order: o.sort_order }).eq('id', swapWith.id),
    ]);
    setBusy(false);
    await load();
  }

  if (!loaded) return null;

  return (
    <div>
      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}

      {options.length === 0 && <div className="empty-state">No scope options yet — add at least two below.</div>}
      {options.length === 1 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
          Add at least one more option — the customer needs two or more to choose between.
        </div>
      )}

      {options.map((o, idx) => (
        <ScopeOptionEditor
          key={o.id}
          option={o}
          jobId={jobId}
          isLocked={isLocked}
          isPicked={isLocked && job.selected_scope_option_id === o.id}
          isFirst={idx === 0}
          isLast={idx === options.length - 1}
          busy={busy}
          onUpdate={updateOption}
          onDelete={() => deleteOption(o)}
          onMove={dir => moveOption(o, dir)}
        />
      ))}

      <div className="section-actions">
        <button className="btn btn-sm" onClick={addOption} disabled={busy || isLocked}>+ Add option</button>
      </div>
    </div>
  );
}

// Its own local item list (seeded once from the option, not resynced on
// every prop refresh) — same pattern as ScopeCard's single-scope editor —
// so typing a line isn't overwritten by a stale controlled value on the
// next keystroke or realtime refresh.
function ScopeOptionEditor({ option, jobId, isLocked, isPicked, isFirst, isLast, busy, onUpdate, onDelete, onMove }) {
  const [label, setLabel] = useState(option.label);
  const [description, setDescription] = useState(option.description || '');
  const [items, setItems] = useState((option.scope_items || []).map(i => i.text || ''));
  const [dirty, setDirty] = useState(false);

  function addItem() { setItems(prev => [...prev, '']); setDirty(true); }
  function updateItem(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); setDirty(true); }
  function removeItem(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); setDirty(true); }

  function saveScope() {
    onUpdate(option.id, { scope_items: items.filter(t => t.trim()).map(text => ({ text })) });
    setDirty(false);
  }

  return (
    <div style={{ border: '1px solid var(--panel-line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={e => { if (e.target.value.trim() && e.target.value !== option.label) onUpdate(option.id, { label: e.target.value.trim() }); }}
            style={{ fontWeight: 700, marginBottom: 6 }}
            disabled={isLocked}
          />
          <textarea
            value={description}
            placeholder="Description shown to the customer (optional)"
            onChange={e => setDescription(e.target.value)}
            onBlur={e => { if (e.target.value !== (option.description || '')) onUpdate(option.id, { description: e.target.value }); }}
            disabled={isLocked}
            rows={2}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isPicked && <span className="badge" style={{ background: '#3a6b45' }}>Picked</span>}
          <button className="btn btn-sm" onClick={() => onMove(-1)} disabled={busy || isFirst}>↑</button>
          <button className="btn btn-sm" onClick={() => onMove(1)} disabled={busy || isLast}>↓</button>
          <button className="btn btn-sm btn-danger" onClick={onDelete} disabled={busy || isLocked}>Delete</button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px' }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--ink-soft)' }}>Price: </span>
          <b>{fmtMoney(option.price)}</b>
        </div>
        <Link href={`/jobs/${jobId}?tab=Estimate&section=cost&costOption=${option.id}`} className="btn btn-sm">
          {option.price ? 'Update cost & price' : 'Price on Cost tab'} →
        </Link>
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 11 }}>Full scope of work for this option</label>
        {items.length === 0 && <div className="empty-state" style={{ padding: '8px 0' }}>No scope items yet.</div>}
        {items.map((text, i) => (
          <div className="list-row" key={i}>
            <textarea value={text} onChange={e => updateItem(i, e.target.value)} disabled={isLocked} />
            <button className="row-remove" onClick={() => removeItem(i)} disabled={isLocked}>×</button>
          </div>
        ))}
        <div className="section-actions">
          <button className="btn btn-sm" onClick={addItem} disabled={isLocked}>+ Add item</button>
          <button className="btn btn-primary btn-sm" onClick={saveScope} disabled={isLocked || !dirty}>Save scope</button>
        </div>
      </div>
    </div>
  );
}
