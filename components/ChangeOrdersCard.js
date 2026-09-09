'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import Link from 'next/link';

export default function ChangeOrdersCard({ jobId, changeOrders }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', co_date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit() {
    setSaving(true);
    await supabase.from('change_orders').insert({
      job_id: jobId,
      description: form.description,
      amount: form.amount ? parseFloat(String(form.amount).replace(/[^0-9.]/g, '')) : null,
      co_date: form.co_date,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ description: '', amount: '', co_date: new Date().toISOString().slice(0, 10) });
  }

  async function removeCo(coId) {
    if (!confirm('Delete this change order?')) return;
    await supabase.from('change_orders').delete().eq('id', coId);
  }

  return (
    <div className="card">
      <h3>Change orders</h3>

      {showForm ? (
        <div>
          <label>Description of change</label>
          <textarea value={form.description} onChange={e => update('description', e.target.value)} />
          <div className="two-col">
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} placeholder="e.g. 1,200" /></div>
            <div><label>Date</label><input type="date" value={form.co_date} onChange={e => update('co_date', e.target.value)} /></div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create change order'}</button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ New change order</button>
        </div>
      )}

      {changeOrders.length === 0 && <div className="empty-state">No change orders yet.</div>}
      {changeOrders.map(co => (
        <div className="update-entry" key={co.id}>
          <div className="update-date">{co.co_date} — {co.amount ? '$' + Number(co.amount).toLocaleString('en-US') : '—'}</div>
          {co.description && <p>{co.description}</p>}
          <div className="section-actions">
            <Link href={`/jobs/${jobId}/change-orders/${co.id}`} className="btn btn-sm">View / print</Link>
            <button className="btn btn-sm btn-danger" onClick={() => removeCo(co.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
