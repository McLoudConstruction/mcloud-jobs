'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import AIScopeGenerator from './AIScopeGenerator';
import ScopeOptionsCard from './ScopeOptionsCard';
import { flagScheduleStale } from '../lib/scheduleStale';

export default function ScopeCard({ job, jobId, onSave }) {
  const [items, setItems] = useState((job.scope_items || []).map(i => i.text || ''));
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

  async function setMode(next) {
    if (next === mode || isLocked) return;
    if (next === 'multi' && !window.confirm('Switch to multiple scope options? The customer will pick one entirely separate scope of work (and price) to move forward with, instead of a single fixed scope.')) return;
    if (next === 'single' && !window.confirm('Switch back to a single scope? Any scope options you built stay saved but will no longer be shown to the customer — the scope below becomes the estimate again.')) return;
    await onSave({ estimate_mode: next });
  }

  return (
    <>
      <div className="card">
        <h3>Scope of work</h3>

        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>This estimate has:</span>
          <button className={`btn btn-sm ${mode === 'single' ? 'btn-primary' : ''}`} onClick={() => setMode('single')} disabled={isLocked}>One scope</button>
          <button className={`btn btn-sm ${mode === 'multi' ? 'btn-primary' : ''}`} onClick={() => setMode('multi')} disabled={isLocked}>Multiple scope options</button>
        </div>

        {mode === 'single' ? (
          <>
            <AIScopeGenerator
              projectType={job.project_type}
              jobId={jobId}
              onGenerate={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])}
              onTradeActions={saveTradeActions}
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
              Two or more entirely separate scopes for this project — each with its own full scope of work and its own price. The customer picks one on the estimate document; only that one moves forward.
            </div>
            <ScopeOptionsCard job={job} jobId={jobId} />
          </>
        )}
      </div>
    </>
  );
}
