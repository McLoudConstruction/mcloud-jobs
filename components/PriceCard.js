'use client';
import { useState } from 'react';

// Strips non-numeric characters and caps input to 2 decimal places as
// the user types — e.g. "185000.999" becomes "185000.99".
function sanitizeMoney(raw) {
  let v = raw.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  }
  return v;
}

export default function PriceCard({ job, onSave }) {
  const [price, setPrice] = useState(job.contract_price ?? '');
  const [projectedCost, setProjectedCost] = useState(job.projected_cost ?? '');
  const [approvedDate, setApprovedDate] = useState(job.approved_at ? job.approved_at.slice(0, 10) : '');
  const [milestones, setMilestones] = useState(job.milestones || []);

  function add() { setMilestones(prev => [...prev, { desc: '', amount: '' }]); }
  function update(i, field, v) { setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: v } : m)); }
  function remove(i) { setMilestones(prev => prev.filter((_, idx) => idx !== i)); }
  function save() {
    onSave({
      contract_price: price ? Math.round(parseFloat(String(price).replace(/[^0-9.]/g, '')) * 100) / 100 : null,
      projected_cost: projectedCost ? parseFloat(String(projectedCost).replace(/[^0-9.]/g, '')) : null,
      approved_at: approvedDate ? new Date(approvedDate + 'T12:00:00').toISOString() : null,
      milestones,
    });
  }

  return (
    <div className="card">
      <h3>Contract price &amp; payment schedule</h3>
      <label>Total contract price ($)</label>
      <input value={price} onChange={e => setPrice(sanitizeMoney(e.target.value))} placeholder="e.g. 185000.00" />
      <label style={{ marginTop: 12 }}>Projected cost ($)</label>
      <input value={projectedCost} onChange={e => setProjectedCost(e.target.value)} placeholder="What you expect this job to cost, all-in" />
      <label style={{ marginTop: 12 }}>Approved date</label>
      <input type="date" value={approvedDate} onChange={e => setApprovedDate(e.target.value)} />
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
        Drives which month this job's contract price counts as Revenue on the Financial Dashboard. Set automatically when the job first moves to Approved — edit here if it's wrong.
      </div>
      <label style={{ marginTop: 16 }}>Payment milestones</label>
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
        <button className="btn btn-primary btn-sm" onClick={save}>Save price &amp; schedule</button>
      </div>
    </div>
  );
}
