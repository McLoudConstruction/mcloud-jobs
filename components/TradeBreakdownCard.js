'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { SERVICES_OFFERED } from '../lib/constants';
import { flagScheduleStale } from '../lib/scheduleStale';

const EMPTY_ROW = { description: '', trade: SERVICES_OFFERED[0], unit_label: '', quantity: 1, area: '' };

export default function TradeBreakdownCard({ jobId, readOnly, linkHref }) {
  const [actions, setActions] = useState([]);
  const [view, setView] = useState('trade'); // 'trade' | 'area' | 'flat'
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ROW);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('job_scope_actions').select('*').eq('job_id', jobId).order('trade', { ascending: true });
    if (data) setActions(data);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`scope-actions-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'job_scope_actions', filter: `job_id=eq.${jobId}` }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function startAdd() {
    setForm(EMPTY_ROW);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(a) {
    setForm({ description: a.description, trade: a.trade || SERVICES_OFFERED[0], unit_label: a.unit_label || '', quantity: a.quantity ?? 1, area: a.area || '' });
    setEditingId(a.id);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.description.trim()) return;
    const payload = { ...form, quantity: Number(form.quantity) || 1, area: form.area.trim() || null };
    let error;
    if (editingId) {
      ({ error } = await supabase.from('job_scope_actions').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('job_scope_actions').insert({ ...payload, job_id: jobId }));
    }
    if (error) { setError(error.message); return; }
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_ROW);
    setError('');
    // Don't rely solely on the realtime subscription — refresh directly
    // so the change shows up immediately.
    await load();
    await flagScheduleStale(jobId);
  }

  async function remove(id) {
    if (!confirm('Remove this action?')) return;
    const { error } = await supabase.from('job_scope_actions').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    await load();
    await flagScheduleStale(jobId);
  }

  const grouped = actions.reduce((acc, a) => {
    const key = a.trade || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  const groupedByArea = actions.reduce((acc, a) => {
    const key = a.area || 'Whole job';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});
  const usesAreas = Object.keys(groupedByArea).some(k => k !== 'Whole job');

  return (
    <div className="card">
      <h3>Exhaustive Action List &amp; Trade Breakdown</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        {readOnly
          ? <>Reference only — this is what the job needs, for pricing. {linkHref && <a href={linkHref} style={{ color: 'var(--accent)', fontWeight: 600 }}>Edit on the Scope tab →</a>}</>
          : "The full internal task list behind the customer estimate — this is what actually populates a subcontractor's work order by trade."}
      </div>

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className={`btn btn-sm ${view === 'trade' ? 'btn-primary' : ''}`} onClick={() => setView('trade')}>By Trade</button>
        {usesAreas && <button className={`btn btn-sm ${view === 'area' ? 'btn-primary' : ''}`} onClick={() => setView('area')}>By Area</button>}
        <button className={`btn btn-sm ${view === 'flat' ? 'btn-primary' : ''}`} onClick={() => setView('flat')}>Flat List</button>
        {!readOnly && <button className="btn btn-sm" onClick={startAdd}>{showForm && !editingId ? 'Cancel' : '+ Add action'}</button>}
      </div>

      {!readOnly && showForm && (
        <form onSubmit={save} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <label>Description</label>
          <input value={form.description} onChange={e => update('description', e.target.value)} required placeholder="e.g. Detach and reset kitchen faucet" />
          <div className="two-col" style={{ marginTop: 10 }}>
            <div>
              <label>Trade</label>
              <select value={form.trade} onChange={e => update('trade', e.target.value)}>
                {SERVICES_OFFERED.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label>Unit</label><input value={form.unit_label} onChange={e => update('unit_label', e.target.value)} placeholder="e.g. faucet" /></div>
            <div><label>Quantity</label><input type="number" min="0" step="1" value={form.quantity} onChange={e => update('quantity', e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Area <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(optional — for jobs stepped across multiple spaces)</span></label>
            <input value={form.area} onChange={e => update('area', e.target.value)} placeholder="e.g. Bathroom 1 — leave blank if it's for the whole job" />
          </div>
          {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit">{editingId ? 'Save changes' : 'Add action'}</button>
          </div>
        </form>
      )}

      {actions.length === 0 && !showForm && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          Nothing here yet — generate with AI from the scope section above, or add actions manually.
        </div>
      )}

      {actions.length > 0 && view === 'trade' && (
        <div style={{ marginTop: 14 }}>
          {Object.entries(grouped).map(([trade, rows]) => (
            <div key={trade} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
                {trade} <span style={{ color: 'var(--ink-soft)', fontWeight: 400, textTransform: 'none' }}>({rows.length})</span>
              </div>
              {rows.map(a => (
                <ActionRow key={a.id} a={a} readOnly={readOnly} onEdit={() => startEdit(a)} onRemove={() => remove(a.id)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && view === 'area' && (
        <div style={{ marginTop: 14 }}>
          {Object.entries(groupedByArea).map(([area, rows]) => (
            <div key={area} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>
                {area} <span style={{ color: 'var(--ink-soft)', fontWeight: 400, textTransform: 'none' }}>({rows.length})</span>
              </div>
              {rows.map(a => (
                <ActionRow key={a.id} a={a} showTrade readOnly={readOnly} onEdit={() => startEdit(a)} onRemove={() => remove(a.id)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && view === 'flat' && (
        <div style={{ marginTop: 14 }}>
          {actions.map(a => (
            <ActionRow key={a.id} a={a} showTrade readOnly={readOnly} onEdit={() => startEdit(a)} onRemove={() => remove(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({ a, showTrade, readOnly, onEdit, onRemove }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
      <div>
        <b>{a.quantity}{a.unit_label ? ` ${a.unit_label}${a.quantity === 1 ? '' : 's'}` : ''}</b> — {a.description}
        {showTrade && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{a.trade || 'Other'}{a.area ? ` · ${a.area}` : ''}</div>}
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-sm" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-danger" onClick={onRemove}>Delete</button>
        </div>
      )}
    </div>
  );
}
