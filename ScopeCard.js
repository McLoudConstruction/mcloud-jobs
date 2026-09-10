'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import AIScopeGenerator from './AIScopeGenerator';
import { flagScheduleStale } from '../lib/scheduleStale';

export default function ScopeCard({ job, jobId, onSave }) {
  const [items, setItems] = useState((job.scope_items || []).map(i => i.text || ''));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ scope_items: items.filter(t => t.trim()).map(text => ({ text })) }); }

  async function saveTradeActions(tradeActions) {
    const { error } = await supabase.from('job_scope_actions').insert(tradeActions.map(a => ({ ...a, job_id: jobId })));
    if (error) { alert('Failed to save the generated trade actions: ' + error.message); return; }
    await flagScheduleStale(jobId);
  }

  return (
    <>
      <div className="card">
        <h3>Scope of work</h3>
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
      </div>
    </>
  );
}
