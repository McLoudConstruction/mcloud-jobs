'use client';
import { useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import AIScopeGenerator from './AIScopeGenerator';
import VoiceScopeRecorder from './VoiceScopeRecorder';
import AssemblyPicker from './AssemblyPicker';
import EstimateGuardrailBanner from './EstimateGuardrailBanner';
import ScopeOptionsCard from './ScopeOptionsCard';
import EstimateGroupsCard from './EstimateGroupsCard';
import { flagScheduleStale } from '../lib/scheduleStale';

// The Scope card. Everything that adds to the estimate's scope lives in its
// header, top right:
//   row 1  From assembly, Generate scope with AI   (build the scope text)
//   row 2  Add Scope Variation, Add Alternates      (change what the customer chooses between)
//
// A scope variation is an entirely separate scope and price (Option A: patch
// repair, Option B: full replacement). The first variation turns the estimate
// into "multiple scope options" mode (job.estimate_mode = 'multi') and the
// current scope becomes Option A, so nothing already written is left behind.
// Alternates are optional add-ons layered on top of whichever scope is chosen.
export default function ScopeCard({ job, jobId, onSave }) {
  const [items, setItems] = useState((job.scope_items || []).map(i => i.text || ''));
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const optionsRef = useRef(null);
  const groupsRef = useRef(null);
  const mode = job.estimate_mode || 'single';
  const isLocked = !!job.estimate_groups_submitted_at;

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ scope_items: items.filter(t => t.trim()).map(text => ({ text })) }); }

  async function saveTradeActions(tradeActions) {
    const { error } = await supabase.from('job_scope_actions').insert(tradeActions.map(a => ({ ...a, job_id: jobId })));
    if (error) { alert('Failed to save the generated trade actions: ' + error.message); return; }
    await flagScheduleStale(jobId);
  }

  async function backToSingle() {
    if (isLocked) return;
    if (!window.confirm('Go back to a single scope? Your variations stay saved but the customer will no longer see them. The scope above becomes the estimate again.')) return;
    await onSave({ estimate_mode: 'single' });
  }

  async function addVariation() {
    if (isLocked || busy) return;

    // Already in variation mode: just add another one.
    if (mode === 'multi') {
      const label = window.prompt('Name this variation (e.g. "Option C: Partial Replacement"):');
      if (!label || !label.trim()) return;
      await optionsRef.current?.addOption(label.trim());
      return;
    }

    // First variation. The current scope becomes Option A (unless variations
    // from an earlier switch are still saved), then the new one is added.
    const label = window.prompt('Name the new scope variation (e.g. "Option B: Full Replacement").\n\nYour current scope becomes "Option A" so the customer can choose between the two.');
    if (!label || !label.trim()) return;
    setBusy(true);
    try {
      const { data: existing, error: existingError } = await supabase.from('estimate_scope_options').select('id').eq('job_id', jobId);
      if (existingError) throw existingError;
      const rows = [];
      if (!existing || existing.length === 0) {
        rows.push({
          job_id: jobId,
          label: 'Option A',
          sort_order: 0,
          scope_items: items.filter(t => t.trim()).map(text => ({ text })),
        });
      }
      // scope_items must be set explicitly: in a multi-row insert, PostgREST
      // fills any key missing from a row with null (not the column default),
      // and the column is NOT NULL.
      rows.push({ job_id: jobId, label: label.trim(), scope_items: [], sort_order: (existing?.length || 0) + rows.length });
      const { error: insertError } = await supabase.from('estimate_scope_options').insert(rows);
      if (insertError) throw insertError;
      await onSave({ estimate_mode: 'multi' });
    } catch (err) {
      alert('Could not add the scope variation: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  function addAlternate() {
    groupsRef.current?.addGroup();
  }

  return (
    <>
      <div className="card">
        <div className="scope-card-head">
          <h3>Scope of work</h3>
          <div className="scope-card-actions">
            {mode === 'single' && (
              <div className="scope-card-actions-row">
                <AssemblyPicker align="right" onApply={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])} />
                <button type="button" className="btn btn-sm" onClick={() => setAiOpen(o => !o)}>Generate scope with AI</button>
              </div>
            )}
            <div className="scope-card-actions-row">
              <button type="button" className="btn btn-sm btn-primary" onClick={addVariation} disabled={isLocked || busy}>+ Add Scope Variation</button>
              <button type="button" className="btn btn-sm" onClick={addAlternate} disabled={isLocked}>+ Add Alternates</button>
            </div>
          </div>
        </div>

        <EstimateGuardrailBanner job={job} />

        {mode === 'single' ? (
          <>
            <AIScopeGenerator
              projectType={job.project_type}
              jobId={jobId}
              open={aiOpen}
              onOpenChange={setAiOpen}
              hideTrigger
              onGenerate={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])}
              onTradeActions={saveTradeActions}
            />
            <VoiceScopeRecorder
              projectType={job.project_type}
              jobId={jobId}
              existingItems={items.filter(t => t.trim())}
              onGenerate={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])}
            />
            {items.length === 0 && <div className="empty-state">No scope items yet.</div>}
            {items.map((text, i) => (
              <div className="list-row" key={i}>
                <textarea value={text} onChange={e => update(i, e.target.value)} />
                <button className="row-remove" onClick={() => remove(i)}>×</button>
              </div>
            ))}
            <div className="section-actions">
              <button className="btn btn-sm" onClick={add}>+ Add item</button>
              <button className="btn btn-primary btn-sm" onClick={save}>Save scope</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Two or more entirely separate scopes for this project, each with its own full scope of work and its own price. The customer picks one on the estimate document and only that one moves forward.
              {!isLocked && (
                <>
                  {' '}
                  <button type="button" onClick={backToSingle} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-soft)', textDecoration: 'underline', fontSize: 11.5, fontFamily: 'inherit' }}>
                    Use a single scope instead
                  </button>
                </>
              )}
            </div>
            <ScopeOptionsCard ref={optionsRef} job={job} jobId={jobId} />
          </>
        )}

        <EstimateGroupsCard ref={groupsRef} job={job} jobId={jobId} />
      </div>
    </>
  );
}
