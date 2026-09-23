'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Multi-option mode: two or more ENTIRELY SEPARATE scopes of work for the
// same project (e.g. "Option A: patch repair" vs "Option B: full
// replacement"), each with its own full scope and its own price. Only one
// moves forward — the customer picks interactively on the estimate
// document. Rendered by ScopeCard in place of the single scope editor
// when job.estimate_mode === 'multi'.
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
        <div key={o.id} style={{ border: '1px solid var(--panel-line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <input
                value={o.label}
                onChange={e => setOptions(prev => prev.map(x => x.id === o.id ? { ...x, label: e.target.value } : x))}
                onBlur={e => updateOption(o.id, { label: e.target.value })}
                style={{ fontWeight: 700, marginBottom: 6 }}
                disabled={isLocked}
              />
              <textarea
                value={o.description || ''}
                placeholder="Description shown to the customer (optional)"
                onChange={e => setOptions(prev => prev.map(x => x.id === o.id ? { ...x, description: e.target.value } : x))}
                onBlur={e => updateOption(o.id, { description: e.target.value })}
                disabled={isLocked}
                rows={2}
              />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {isLocked && job.selected_scope_option_id === o.id && (
                <span className="badge" style={{ background: '#3a6b45' }}>Picked</span>
              )}
              <button className="btn btn-sm" onClick={() => moveOption(o, -1)} disabled={busy || idx === 0}>↑</button>
              <button className="btn btn-sm" onClick={() => moveOption(o, 1)} disabled={busy || idx === options.length - 1}>↓</button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteOption(o)} disabled={busy || isLocked}>Delete</button>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11 }}>Price</label>
              <input
                type="number" step="0.01" style={{ width: 140 }}
                value={o.price ?? ''}
                onChange={e => setOptions(prev => prev.map(x => x.id === o.id ? { ...x, price: e.target.value } : x))}
                onBlur={e => updateOption(o.id, { price: e.target.value ? parseFloat(e.target.value) : null })}
                disabled={isLocked}
              />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <label style={{ fontSize: 11 }}>Full scope of work for this option (one line per item)</label>
              <textarea
                value={(o.scope_items || []).map(i => i.text).join('\n')}
                onChange={e => setOptions(prev => prev.map(x => x.id === o.id ? { ...x, _scopeText: e.target.value } : x))}
                onBlur={e => updateOption(o.id, { scope_items: e.target.value.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text })) })}
                rows={6}
                disabled={isLocked}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="section-actions">
        <button className="btn btn-sm" onClick={addOption} disabled={busy || isLocked}>+ Add option</button>
      </div>
    </div>
  );
}
