'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

const STAGES = ['prospecting', 'contacted', 'proposal', 'won', 'lost'];
const STAGE_LABELS = { prospecting: 'Prospecting', contacted: 'Contacted', proposal: 'Proposal Sent', won: 'Won', lost: 'Lost' };

const EMPTY_FORM = { company: '', project: '', contact_name: '', anticipated_timeline: '', date_taken: new Date().toISOString().slice(0, 10), notes: '' };

export default function SalesDashboardPage() {
  const { session, loading } = useRequireAuth();
  const [opps, setOpps] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [stageFilter, setStageFilter] = useState('all');
  const [lossReasonPromptId, setLossReasonPromptId] = useState(null);
  const [lossReasonText, setLossReasonText] = useState('');

  const loadOpps = useCallback(async () => {
    const { data } = await supabase.from('opportunities').select('*').order('date_taken', { ascending: false });
    if (data) setOpps(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadOpps();
    const channel = supabase.channel('opportunities').on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, loadOpps).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadOpps]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.company.trim() && !form.project.trim()) return;
    setSaving(true);
    if (editingId) {
      await supabase.from('opportunities').update(form).eq('id', editingId);
    } else {
      await supabase.from('opportunities').insert({ ...form, stage: 'prospecting' });
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(o) {
    setForm({ ...EMPTY_FORM, ...o });
    setEditingId(o.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function setStage(id, stage) {
    if (stage === 'lost') {
      setLossReasonPromptId(id);
      setLossReasonText('');
      return;
    }
    await supabase.from('opportunities').update({ stage }).eq('id', id);
  }

  async function confirmLoss() {
    await supabase.from('opportunities').update({ stage: 'lost', loss_reason: lossReasonText }).eq('id', lossReasonPromptId);
    setLossReasonPromptId(null);
    setLossReasonText('');
  }

  async function removeOpp(id) {
    if (!confirm('Delete this opportunity?')) return;
    await supabase.from('opportunities').delete().eq('id', id);
  }

  const stats = useMemo(() => {
    const byStage = {};
    STAGES.forEach(s => { byStage[s] = opps.filter(o => o.stage === s).length; });
    return byStage;
  }, [opps]);

  const filtered = stageFilter === 'all' ? opps : opps.filter(o => o.stage === stageFilter);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Sales Dashboard</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={() => { setShowForm(s => !s); setEditingId(null); setForm(EMPTY_FORM); }}>
              {showForm ? 'Cancel' : '+ New sales lead'}
            </button>
            <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: -10, marginBottom: 16 }}>
          "New sales lead" tracks a prospect in your pipeline below. "New Opportunity" creates an actual project — this is the only way to start one.
        </div>

        <div className="card">
          <h3>Pipeline overview</h3>
          <div className="two-col">
            {STAGES.map(s => (
              <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
                <span>{STAGE_LABELS[s]}</span>
                <span style={{ fontWeight: 700 }}>{stats[s] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>{editingId ? 'Edit opportunity' : 'New opportunity'}</h3>
            <div className="two-col">
              <div><label>Company</label><input value={form.company} onChange={e => update('company', e.target.value)} /></div>
              <div><label>Project</label><input value={form.project} onChange={e => update('project', e.target.value)} /></div>
              <div><label>Contact name</label><input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} /></div>
              <div><label>Anticipated timeline</label><input value={form.anticipated_timeline} onChange={e => update('anticipated_timeline', e.target.value)} placeholder="e.g. Q1 2027" /></div>
              <div><label>Date taken</label><input type="date" value={form.date_taken} onChange={e => update('date_taken', e.target.value)} /></div>
            </div>
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create opportunity')}</button>
            </div>
          </form>
        )}

        {lossReasonPromptId && (
          <div className="card">
            <h3>Reason for loss</h3>
            <textarea value={lossReasonText} onChange={e => setLossReasonText(e.target.value)} placeholder="e.g. Went with another contractor, budget cut, timeline no longer fits…" />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={confirmLoss}>Save &amp; mark lost</button>
              <button className="btn btn-sm" onClick={() => setLossReasonPromptId(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="stage-tabs">
          <button className={`stage-tab ${stageFilter === 'all' ? 'active' : ''}`} onClick={() => setStageFilter('all')}>All ({opps.length})</button>
          {STAGES.map(s => (
            <button key={s} className={`stage-tab ${stageFilter === s ? 'active' : ''}`} onClick={() => setStageFilter(s)}>
              {STAGE_LABELS[s]} ({stats[s] || 0})
            </button>
          ))}
        </div>

        {filtered.length === 0 && <div className="empty-state">No opportunities here yet.</div>}
        {filtered.map(o => (
          <div className="job-row" key={o.id} style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="job-main">
              <span className="job-customer">{o.company || 'Unnamed'} {o.project ? `— ${o.project}` : ''}</span>
              <span className="job-address">{o.contact_name}{o.anticipated_timeline ? ` · ${o.anticipated_timeline}` : ''}</span>
              {o.stage === 'lost' && o.loss_reason && <span className="job-address" style={{ color: '#a13f3f' }}>Loss reason: {o.loss_reason}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={o.stage} onChange={e => setStage(o.id, e.target.value)} style={{ width: 'auto' }}>
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
              <button className="btn btn-sm" onClick={() => startEdit(o)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => removeOpp(o.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
