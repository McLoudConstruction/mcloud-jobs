'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import Link from 'next/link';
import { CHANGE_ORDER_REASON_CATEGORIES } from '../lib/constants';

const REASON_CATEGORY_KEYS = Object.keys(CHANGE_ORDER_REASON_CATEGORIES);
const EMPTY_FORM = { description: '', amount: '', co_date: new Date().toISOString().slice(0, 10), reason_category: '', reason: '' };

export default function ChangeOrdersCard({ jobId, changeOrders, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recentUpdates, setRecentUpdates] = useState([]);
  const [updatePhotos, setUpdatePhotos] = useState({}); // updateId -> [{id, url}]

  const loadRecentUpdates = useCallback(async () => {
    const { data } = await supabase.from('job_updates').select('*').eq('job_id', jobId).eq('is_internal', true).order('created_at', { ascending: false }).limit(5);
    if (!data) return;
    setRecentUpdates(data);
    const { data: photos } = await supabase.from('job_photos').select('*').in('update_id', data.map(u => u.id));
    const byUpdate = {};
    for (const p of photos || []) (byUpdate[p.update_id] = byUpdate[p.update_id] || []).push(p);
    const signed = {};
    for (const [updateId, pics] of Object.entries(byUpdate)) {
      signed[updateId] = await Promise.all(pics.map(async p => {
        const { data: s } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
        return { id: p.id, storage_path: p.storage_path, url: s?.signedUrl };
      }));
    }
    setUpdatePhotos(signed);
  }, [jobId]);

  useEffect(() => { loadRecentUpdates(); }, [loadRecentUpdates]);

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'reason_category') next.reason = '';
      return next;
    });
  }

  function fillFromUpdate(u) {
    setShowForm(true);
    setForm(prev => ({ ...prev, description: u.issues_notes || prev.description, co_date: (u.created_at || '').slice(0, 10) || prev.co_date, _sourceUpdateId: u.id }));
  }

  async function submit() {
    setSaving(true);
    setError('');
    const coId = crypto.randomUUID();
    const { error: insertError } = await supabase.from('change_orders').insert({
      id: coId,
      job_id: jobId,
      description: form.description,
      amount: form.amount ? parseFloat(String(form.amount).replace(/[^0-9.]/g, '')) : null,
      co_date: form.co_date,
      reason_category: form.reason_category || null,
      reason: form.reason || null,
    });
    if (insertError) {
      setSaving(false);
      setError(insertError.message);
      return;
    }
    // Carry over any photos from the Internal Update this was filled from.
    const sourcePhotos = form._sourceUpdateId ? (updatePhotos[form._sourceUpdateId] || []) : [];
    for (const p of sourcePhotos) {
      const newPath = `${jobId}/${Date.now()}-${p.id}-co.jpg`;
      const { error: copyError } = await supabase.storage.from('job-photos').copy(p.storage_path, newPath);
      if (!copyError) {
        await supabase.from('job_photos').insert({ job_id: jobId, change_order_id: coId, storage_path: newPath });
      }
    }
    setSaving(false);
    setShowForm(false);
    setForm(EMPTY_FORM);
    // Don't rely solely on the parent's realtime subscription — refresh
    // directly so the new change order shows up immediately.
    await onChanged?.();
  }

  async function removeCo(coId) {
    if (!confirm('Delete this change order?')) return;
    const { error: deleteError } = await supabase.from('change_orders').delete().eq('id', coId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await onChanged?.();
  }

  return (
    <div className="card">
      <h3>Change orders</h3>

      {showForm ? (
        <div>
          <div className="two-col">
            <div>
              <label>Reason category</label>
              <select value={form.reason_category} onChange={e => update('reason_category', e.target.value)}>
                <option value="">Select…</option>
                {REASON_CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Reason</label>
              <select value={form.reason} onChange={e => update('reason', e.target.value)} disabled={!form.reason_category}>
                <option value="">Select…</option>
                {(CHANGE_ORDER_REASON_CATEGORIES[form.reason_category] || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <label style={{ marginTop: 10 }}>Description of change</label>
          <textarea value={form.description} onChange={e => update('description', e.target.value)} />
          <div className="two-col">
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} placeholder="e.g. 1,200" /></div>
            <div><label>Date</label><input type="date" value={form.co_date} onChange={e => update('co_date', e.target.value)} /></div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create change order'}</button>
            <button className="btn btn-sm" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ New change order</button>
        </div>
      )}

      <div style={{ marginTop: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 10 }}>
          Recent Internal Updates
        </div>
        {recentUpdates.length === 0 && <div className="empty-state">No internal updates logged yet.</div>}
        {recentUpdates.map(u => (
          <div key={u.id} className="update-entry">
            <div className="update-date">{new Date(u.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            {u.issues_notes && <p>{u.issues_notes}</p>}
            {updatePhotos[u.id]?.length > 0 && (
              <div className="update-photo-strip">
                {updatePhotos[u.id].map(p => <img key={p.id} src={p.url} alt="" />)}
              </div>
            )}
            <div className="section-actions">
              <button className="btn btn-sm" onClick={() => fillFromUpdate(u)}>Fill Change Order with Internal Update</button>
            </div>
          </div>
        ))}
      </div>

      {changeOrders.length === 0 && <div className="empty-state">No change orders yet.</div>}
      {error && <div style={{ fontSize: 12, color: '#a13f3f', margin: '10px 0' }}>{error}</div>}
      {changeOrders.map(co => (
        <div className="update-entry" key={co.id}>
          <div className="update-date">{co.co_date} — {co.amount ? '$' + Number(co.amount).toLocaleString('en-US') : '—'}</div>
          {co.reason && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{co.reason_category ? `${co.reason_category} · ` : ''}{co.reason}</div>}
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
