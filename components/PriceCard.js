'use client';
import { useState } from 'react';

export default function PriceCard({ job, onSave }) {
  const [milestones, setMilestones] = useState(job.milestones || []);

  function add() { setMilestones(prev => [...prev, { desc: '', amount: '' }]); }
  function update(i, field, v) { setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: v } : m)); }
  function remove(i) { setMilestones(prev => prev.filter((_, idx) => idx !== i)); }
  function save() {
    onSave({ milestones });
  }

  return (
    <div className="card">
      <h3>Payment Schedule</h3>
      <label>Payment milestones</label>
      {milestones.length === 0 && <div className="empty-state">No milestones yet.</div>}
      {milestones.map((m, i) => (
        <div className="list-row" key={i}>
          <textarea value={m.desc} onChange={e => update(i, 'desc', e.target.value)} placeholder="e.g. Due upon substantial completion" />
          <input className="amount" value={m.amount} onChange={e => update(i, 'amount', e.target.value)} placeholder="$ or %" />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add milestone</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
      </div>
    </div>
  );
}
