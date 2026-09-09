'use client';
import { useState } from 'react';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL } from '../lib/constants';

function standardListFor(type) {
  return type === 'commercial' ? STANDARD_ASSUMPTIONS_COMMERCIAL : STANDARD_ASSUMPTIONS_RESIDENTIAL;
}

export default function TermsCard({ job, onSave }) {
  const existing = (job.additional_terms || []).map(i => i.text || '');
  const [items, setItems] = useState(existing.length ? existing : standardListFor(job.project_type));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ additional_terms: items.filter(t => t.trim()).map(text => ({ text })) }); }
  function restoreStandard() {
    const standard = standardListFor(job.project_type);
    setItems(prev => {
      const existingSet = new Set(prev.map(t => t.trim()));
      const toAdd = standard.filter(t => !existingSet.has(t.trim()));
      return [...prev, ...toAdd];
    });
  }

  return (
    <div className="card">
      <h3>Project Assumptions &amp; Exclusions</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        Standard list matches this job's project type ({job.project_type === 'commercial' ? 'Commercial' : 'Residential'}) — change project type on the Project tab if needed.
      </div>
      {items.length === 0 && <div className="empty-state">None added.</div>}
      {items.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => update(i, e.target.value)} />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add item</button>
        <button className="btn btn-sm" onClick={restoreStandard}>↺ Restore standard list</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save assumptions &amp; exclusions</button>
      </div>
    </div>
  );
}
