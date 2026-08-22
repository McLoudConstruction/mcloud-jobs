'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

const STATUS_LABELS = { draft: 'Draft', sent: 'Awaiting Customer', approved: 'Approved' };

export default function MaterialSelectionsCard({ jobId }) {
  const [selections, setSelections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('material_selections').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    if (data) setSelections(data);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`material-selections-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function createSelection(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const { data } = await supabase.from('material_selections').insert({
      job_id: jobId,
      title: form.title.trim(),
      notes: form.notes.trim() || null,
    }).select().single();
    setSaving(false);
    setForm({ title: '', notes: '' });
    setShowForm(false);
    if (data) window.location.href = `/jobs/${jobId}/material-selections/${data.id}`;
  }

  return (
    <div className="card">
      <h3>Material Selections</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Get approval on a choice between specific products — brand, model, color, photos included — before it's installed.
      </div>

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ New Selection'}</button>
      </div>

      {showForm && (
        <form onSubmit={createSelection} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <label>Title</label>
          <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Kitchen Dishwasher" required />
          <label style={{ marginTop: 8 }}>Notes (optional)</label>
          <textarea value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} />
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create & Add Options →'}</button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 14 }}>
        {selections.length === 0 && <div className="empty-state">No selections yet.</div>}
        {selections.map(s => (
          <Link key={s.id} href={`/jobs/${jobId}/material-selections/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
              <span className={`badge badge-${s.status === 'approved' ? 'paid' : s.status === 'sent' ? 'active' : 'draft'}`}>{STATUS_LABELS[s.status]}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
