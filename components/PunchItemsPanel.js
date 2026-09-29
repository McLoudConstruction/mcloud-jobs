'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import PunchPhotos from './PunchPhotos';
import { PUNCH_STATUS, PUNCH_STATUS_ORDER, PUNCH_OPEN_STATUSES, fmtPunchDate } from '../lib/punch';

const EMPTY = { title: '', description: '', location: '', assigned_company_id: '', due_date: '', priority: 'normal', customer_visible: false };

// Staff view of punch items (kind 'punch') or warranty claims (kind 'warranty')
// on one job. Used by the Closeout tab's Punch List and Warranty sections.
export default function PunchItemsPanel({ jobId, kind, onChanged }) {
  const isWarranty = kind === 'warranty';
  const [items, setItems] = useState([]);
  const [subs, setSubs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('punch_items').select('*').eq('job_id', jobId).eq('kind', kind).order('created_at', { ascending: false });
    setItems(data || []);
  }, [jobId, kind]);

  useEffect(() => {
    load();
    supabase.from('companies').select('id, company_name').eq('company_type', 'Subcontractor').order('company_name').then(({ data }) => setSubs(data || []));
    const channel = supabase.channel(`punch-${kind}-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_items', filter: `job_id=eq.${jobId}` }, () => { load(); if (onChanged) onChanged(); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, kind, load, onChanged]);

  const subName = id => subs.find(s => s.id === id)?.company_name || '';
  const visible = items.filter(i => filter === 'all' || (filter === 'open' ? PUNCH_OPEN_STATUSES.includes(i.status) : !PUNCH_OPEN_STATUSES.includes(i.status)));
  const openCount = items.filter(i => PUNCH_OPEN_STATUSES.includes(i.status)).length;

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('punch_items').insert({
      job_id: jobId, kind, title: form.title.trim(), description: form.description.trim() || null, location: form.location.trim() || null,
      assigned_company_id: form.assigned_company_id || null, due_date: form.due_date || null, priority: form.priority,
      customer_visible: isWarranty ? true : form.customer_visible, reported_by_kind: 'staff',
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setForm(EMPTY);
    setShowForm(false);
    load();
  }

  async function patch(item, changes) {
    setError('');
    const { error: err } = await supabase.from('punch_items').update(changes).eq('id', item.id);
    if (err) { setError(err.message); return false; }
    load();
    return true;
  }

  async function setStatus(item, status) {
    if (status === 'declined') {
      const reason = window.prompt('Why is this claim not covered? The customer will see this.');
      if (!reason || !reason.trim()) return;
      await patch(item, { status, declined_reason: reason.trim() });
      return;
    }
    await patch(item, { status });
  }

  async function acceptAddition(item) {
    await patch(item, { review_state: 'approved' });
  }

  async function declineAddition(item) {
    const reason = window.prompt('Why isn\'t this being added to the list? The customer will see this.');
    if (!reason || !reason.trim()) return;
    await patch(item, { status: 'declined', declined_reason: reason.trim(), review_state: 'approved' });
  }

  async function remove(item) {
    if (!window.confirm('Delete this item and its photos?')) return;
    const { error: err } = await supabase.from('punch_items').delete().eq('id', item.id);
    if (err) setError(err.message); else load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="tab-sections-pills">
          {[['open', `Open (${openCount})`], ['done', 'Closed'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" className={`tab-section-btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : isWarranty ? '+ Log a claim' : '+ Add punch item'}</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      {showForm && (
        <form onSubmit={add} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
          <div className="two-col">
            <div><label>{isWarranty ? 'What is wrong?' : 'Item'}</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder={isWarranty ? 'e.g. Cabinet door sagging' : 'e.g. Touch up paint, hallway'} /></div>
            <div><label>Location</label><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Master bath" /></div>
            <div>
              <label>Assign to a sub (optional)</label>
              <select value={form.assigned_company_id} onChange={e => setForm(f => ({ ...f, assigned_company_id: e.target.value }))}>
                <option value="">— unassigned —</option>
                {subs.map(s => <option key={s.id} value={s.id}>{s.company_name}</option>)}
              </select>
            </div>
            <div><label>Due</label><input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
          </div>
          <label>Details</label>
          <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '8px 0' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.priority === 'urgent'} onChange={e => setForm(f => ({ ...f, priority: e.target.checked ? 'urgent' : 'normal' }))} />Urgent
            </label>
            {!isWarranty && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.customer_visible} onChange={e => setForm(f => ({ ...f, customer_visible: e.target.checked }))} />Show this to the customer in their portal
              </label>
            )}
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Add'}</button>
        </form>
      )}

      {visible.length === 0 && <div className="empty-state">{items.length === 0 ? (isWarranty ? 'No warranty claims.' : 'No punch items yet.') : 'Nothing in this view.'}</div>}

      {visible.map(i => {
        const st = PUNCH_STATUS[i.status];
        const isOpen = openId === i.id;
        const overdue = i.due_date && PUNCH_OPEN_STATUSES.includes(i.status) && i.due_date < new Date().toISOString().slice(0, 10);
        return (
          <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : i.id)}>
              <div>
                <b>{i.priority === 'urgent' ? '⚑ ' : ''}{i.title}</b>
                {!isWarranty && i.review_state === 'pending' && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: '#a13f3f', background: '#fbeae7' }}>Customer added — needs review</span>}
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                  {[i.location, i.assigned_company_id ? `→ ${subName(i.assigned_company_id)}` : 'Unassigned', i.due_date ? `due ${fmtPunchDate(i.due_date)}` : null, i.reported_by_kind === 'customer' ? 'reported by customer' : null, i.customer_visible && !isWarranty ? 'shared with customer' : null].filter(Boolean).join(' · ')}
                  {overdue ? ' · overdue' : ''}
                </div>
              </div>
              <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 10 }}>
                {i.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, marginBottom: 6 }}>{i.description}</div>}
                {i.resolution_note && <div style={{ fontSize: 12.5, marginBottom: 6 }}><b>Fix noted:</b> {i.resolution_note}</div>}
                {i.declined_reason && <div style={{ fontSize: 12.5, marginBottom: 6, color: '#a13f3f' }}><b>Declined:</b> {i.declined_reason}</div>}
                {!isWarranty && i.review_state === 'pending' && (
                  <div className="section-actions" style={{ marginBottom: 10 }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => acceptAddition(i)}>Accept onto the list</button>
                    <button type="button" className="btn btn-sm" onClick={() => declineAddition(i)}>Decline</button>
                  </div>
                )}
                <div className="two-col">
                  <div>
                    <label>Status</label>
                    <select value={i.status} onChange={e => setStatus(i, e.target.value)}>
                      {PUNCH_STATUS_ORDER.map(s => <option key={s} value={s}>{PUNCH_STATUS[s].label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Assigned sub</label>
                    <select value={i.assigned_company_id || ''} onChange={e => patch(i, { assigned_company_id: e.target.value || null })}>
                      <option value="">— unassigned —</option>
                      {subs.map(s => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                    </select>
                  </div>
                  <div><label>Due</label><input type="date" defaultValue={i.due_date || ''} onBlur={e => (e.target.value || null) !== (i.due_date || null) && patch(i, { due_date: e.target.value || null })} /></div>
                </div>
                {!isWarranty && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', margin: '8px 0' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={i.customer_visible} onChange={e => patch(i, { customer_visible: e.target.checked })} />Show this to the customer
                  </label>
                )}
                <PunchPhotos item={i} canAdd />
                <div className="section-actions">
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(i)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
