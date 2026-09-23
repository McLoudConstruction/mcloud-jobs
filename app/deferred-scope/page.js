'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import PopupModal from '../../components/PopupModal';
import DataTable from '../../components/DataTable';

const STATUS_LABELS = { open: 'Open', contacted: 'Contacted', won: 'Won', dead: 'Dead' };
const STATUS_COLORS = { open: '#8a5a3f', contacted: '#2F4858', won: '#3a6b45', dead: '#8a8a8a' };

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Follow-up bucket for scope a customer declined or deferred out of a
// flexible estimate (an unpicked Choose One alternative, an unchecked
// Alternate) — captured from EstimateGroupsCard on the job page. Nothing
// here feeds back into the job automatically; it's a worklist for
// deciding whether and when to bring the deferred scope back as a new
// opportunity.
export default function DeferredScopePage() {
  const { session, loading } = useRequireAuth();
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [editing, setEditing] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('deferred_scope_items').select('*, jobs(job_number, estimate_number, project_address)').order('created_at', { ascending: false });
    if (data) setItems(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const channel = supabase.channel('deferred-scope-items').on('postgres_changes', { event: '*', schema: 'public', table: 'deferred_scope_items' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  async function saveEdit(patch) {
    const { error } = await supabase.from('deferred_scope_items').update(patch).eq('id', editing.id);
    if (error) { alert('Failed to save: ' + error.message); return; }
    setEditing(null);
    await load();
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove "${item.label}" from the bucket? This can't be undone.`)) return;
    const { error } = await supabase.from('deferred_scope_items').delete().eq('id', item.id);
    if (error) { alert('Failed to delete: ' + error.message); return; }
    await load();
  }

  if (loading || !session) return null;

  const filtered = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter);
  const counts = { all: items.length };
  for (const s of Object.keys(STATUS_LABELS)) counts[s] = items.filter(i => i.status === s).length;

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Deferred Scope</h2>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
          Scope a customer chose not to include this time — captured from flexible estimates. Follow up when the timing's right, or mark it dead.
        </div>

        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          {['all', ...Object.keys(STATUS_LABELS)].map(s => (
            <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : STATUS_LABELS[s]} ({counts[s] ?? 0})
            </button>
          ))}
        </div>

        {filtered.length === 0 && <div className="empty-state">Nothing here.</div>}

        {filtered.length > 0 && isMobile && (
          <div className="entity-mobile-list">
            {filtered.map(item => (
              <button key={item.id} className="entity-mobile-row" onClick={() => setEditing(item)}>
                <span className="entity-mobile-row-text">
                  <span className="entity-mobile-row-title">{item.label}</span>
                  <span className="entity-mobile-row-sub">{item.customer_name || 'No customer'} · {fmtMoney(item.price)}</span>
                </span>
                <span className="badge" style={{ background: STATUS_COLORS[item.status] }}>{STATUS_LABELS[item.status]}</span>
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && !isMobile && (
          <DataTable
            getRowKey={i => i.id}
            onRowClick={setEditing}
            rows={filtered}
            columns={[
              { key: 'label', label: 'Item', defaultWidth: 240, render: i => i.label },
              { key: 'customer', label: 'Customer', defaultWidth: 180, filterValue: i => i.customer_name || '', render: i => i.customer_name || '—' },
              { key: 'job', label: 'Job', defaultWidth: 150, filterValue: i => i.jobs?.job_number || '', render: i => i.jobs ? <Link href={`/jobs/${i.job_id}`} onClick={e => e.stopPropagation()}>#{i.jobs.job_number || i.jobs.estimate_number}</Link> : '—' },
              { key: 'price', label: 'Price', defaultWidth: 110, sortValue: i => Number(i.price) || 0, render: i => fmtMoney(i.price) },
              { key: 'status', label: 'Status', defaultWidth: 110, filterable: false, render: i => <span className="badge" style={{ background: STATUS_COLORS[i.status] }}>{STATUS_LABELS[i.status]}</span> },
              { key: 'follow_up_at', label: 'Follow Up', defaultWidth: 120, sortValue: i => i.follow_up_at || '', render: i => fmtDate(i.follow_up_at) },
              { key: 'created_at', label: 'Captured', defaultWidth: 120, sortValue: i => i.created_at, render: i => fmtDate(i.created_at) },
              {
                key: 'actions', label: '', defaultWidth: 80, filterable: false, stopClickPropagation: true,
                render: i => <button className="btn btn-sm btn-danger" onClick={() => deleteItem(i)}>Delete</button>,
              },
            ]}
          />
        )}
      </div>

      {editing && (
        <EditModal item={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
      )}
    </AppShell>
  );
}

function EditModal({ item, onClose, onSave }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes || '');
  const [followUpAt, setFollowUpAt] = useState(item.follow_up_at || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({ status, notes: notes.trim() || null, follow_up_at: followUpAt || null });
    setSaving(false);
  }

  return (
    <PopupModal open onClose={onClose} maxWidth={520}>
      <h3 style={{ marginTop: 0 }}>{item.label}</h3>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        {item.customer_name && <div>{item.customer_name}{item.customer_email ? ` · ${item.customer_email}` : ''}{item.customer_phone ? ` · ${item.customer_phone}` : ''}</div>}
        {item.project_address && <div>{item.project_address}</div>}
        {item.description && <div style={{ marginTop: 6 }}>{item.description}</div>}
      </div>

      <label>Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)}>
        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      <label style={{ marginTop: 12 }}>Follow up date</label>
      <input type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} />

      <label style={{ marginTop: 12 }}>Notes</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Anything worth remembering for next time…" />

      <div className="section-actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </PopupModal>
  );
}
