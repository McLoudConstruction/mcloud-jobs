'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import AIScopeGenerator from './AIScopeGenerator';
import VoiceScopeRecorder from './VoiceScopeRecorder';
import AssemblyPicker from './AssemblyPicker';

// The scope builder for one alternate. It behaves like the job's own scope
// editor: From assembly and Generate scope with AI add lines, the lines are
// edited here, and nothing is stored until Save scope is pressed.
//
// The one difference is where the trade breakdown goes. Generate scope with
// AI also returns an action list, and for an alternate that list is saved to
// the alternate's own list (estimate_group_actions), not the job's, so work
// orders and the schedule never see work the customer has not chosen.
//
// Keeps its own copy of the lines, seeded once from `initialItems`, so a
// refresh of the parent never overwrites what is being typed.
export default function ScopeBuilder({ jobId, groupId, projectType, initialItems, disabled, onSave, onActionsAdded }) {
  const [items, setItems] = useState((initialItems || []).map(i => i.text || ''));
  const [aiOpen, setAiOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function append(newItems) {
    setItems(prev => [...prev.filter(t => t.trim()), ...newItems]);
    setDirty(true);
  }
  function addBlank() { setItems(prev => [...prev, '']); setDirty(true); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); setDirty(true); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); setDirty(true); }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(items.filter(t => t.trim()).map(text => ({ text })));
      setDirty(false);
    } catch (err) {
      setError(err.message || 'Could not save the scope.');
    } finally {
      setSaving(false);
    }
  }

  async function saveTradeActions(tradeActions) {
    const { error: insertError } = await supabase
      .from('estimate_group_actions')
      .insert(tradeActions.map(a => ({ ...a, job_id: jobId, group_id: groupId })));
    if (insertError) {
      setError(insertError.message.includes('estimate_group_actions')
        ? 'Alternate trade breakdowns need migration 178 run in Supabase first.'
        : 'Failed to save the generated trade actions: ' + insertError.message);
      return;
    }
    onActionsAdded?.();
  }

  return (
    <div>
      <div className="scope-card-head" style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, margin: 0 }}>Scope of work for this alternate</label>
        {!disabled && (
          <div className="scope-card-actions-row">
            <AssemblyPicker align="right" onApply={append} />
            <button type="button" className="btn btn-sm" onClick={() => setAiOpen(o => !o)}>Generate scope with AI</button>
          </div>
        )}
      </div>

      {!disabled && (
        <>
          <AIScopeGenerator
            projectType={projectType}
            jobId={jobId}
            open={aiOpen}
            onOpenChange={setAiOpen}
            hideTrigger
            onGenerate={append}
            onTradeActions={saveTradeActions}
          />
          <VoiceScopeRecorder
            projectType={projectType}
            jobId={jobId}
            existingItems={items.filter(t => t.trim())}
            onGenerate={append}
          />
        </>
      )}

      {items.length === 0 && <div className="empty-state" style={{ padding: '8px 0' }}>No scope items yet.</div>}
      {items.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => update(i, e.target.value)} disabled={disabled} />
          <button className="row-remove" onClick={() => remove(i)} disabled={disabled}>×</button>
        </div>
      ))}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={addBlank} disabled={disabled}>+ Add item</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={disabled || saving || !dirty}>
          {saving ? 'Saving…' : 'Save scope'}
        </button>
        {dirty && !saving && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Unsaved changes</span>}
      </div>
    </div>
  );
}
