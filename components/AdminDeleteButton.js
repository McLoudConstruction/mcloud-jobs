'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useStaffAuth } from '../lib/staffAuthContext';
import PopupModal from './PopupModal';

// Owner only delete for a Person, Property or Company.
//
// Renders nothing for anyone who is not an owner. That is a convenience: the
// real rule lives in the database. Direct deletes on these tables are switched
// off for everyone (migration 162), and crm_delete_record() checks for an
// owner itself, so a non-owner who got past this button would still be refused.
//
// Before anything is deleted the owner sees what else would go with it
// (removed), what would only lose its link (unlinked), and whether something
// still depends on the record (blocked, which stops the delete).

const KIND_LABEL = { contact: 'person', property: 'property', company: 'company' };

// Plain names for the tables the database reports. Anything not listed falls
// back to the table name with underscores turned into spaces.
const TABLE_LABELS = {
  contacts: 'people',
  properties: 'properties',
  companies: 'companies',
  opportunities: 'leads',
  jobs: 'jobs',
  rfps: 'RFPs',
  rfp_invitations: 'RFP invitations',
  outreach_touches: 'outreach touches',
  outreach_enrollments: 'email sequence enrollments',
  sales_todos: 'route to-dos',
  job_portal_access: 'customer portal logins',
  invoices: 'invoices',
  receipts: 'receipts',
  job_costs: 'job costs',
  work_orders: 'work orders',
};

function labelFor(table) {
  const bare = String(table || '').replace(/^public\./, '');
  return TABLE_LABELS[bare] || bare.replace(/_/g, ' ');
}

function ImpactList({ title, rows, tone }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: tone || 'var(--ink)', marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
        {rows.map(r => (
          <li key={`${r.table}.${r.column}`}>{Number(r.count).toLocaleString()} {labelFor(r.table)}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminDeleteButton({
  kind,
  recordId,
  name,
  label = 'Delete',
  className = 'btn btn-sm btn-danger',
  onDeleted,
}) {
  const { role } = useStaffAuth() || {};
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');

  if (role !== 'owner') return null;

  async function openDialog(e) {
    e?.stopPropagation?.();
    setOpen(true);
    setPreview(null);
    setError('');
    setTyped('');
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('crm_delete_preview', { p_kind: kind, p_id: recordId });
    setLoading(false);
    if (rpcError) {
      setError(/crm_delete_preview/.test(rpcError.message) && /not.*find|does not exist/i.test(rpcError.message)
        ? 'Delete is not set up yet. Run migration 162 in the Supabase SQL Editor.'
        : rpcError.message);
      return;
    }
    if (!data?.ok) { setError(data?.error || 'Could not check this record.'); return; }
    setPreview(data);
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function confirmDelete() {
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('crm_delete_record', { p_kind: kind, p_id: recordId });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    if (!data?.ok) {
      // Something started depending on it since the preview, or it was already deleted.
      if (data?.impact) setPreview(p => ({ ...(p || {}), impact: data.impact, blocked: (data.impact.blocked || []).length > 0 }));
      setError(data?.error || 'Could not delete this record.');
      return;
    }
    setOpen(false);
    if (onDeleted) await onDeleted(data);
  }

  const noun = KIND_LABEL[kind] || 'record';
  const impact = preview?.impact || {};
  const blocked = Boolean(preview?.blocked);
  const canConfirm = preview && !blocked && typed.trim().toLowerCase() === 'delete' && !busy;

  return (
    <>
      <button type="button" className={className} onClick={openDialog}>{label}</button>
      <PopupModal open={open} onClose={close} maxWidth={500}>
        <div onClick={e => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 6px' }}>Delete this {noun}?</h3>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{preview?.name || name || ''}</div>

          {loading && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 10 }}>Checking what this affects…</div>}
          {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

          {preview && (
            <>
              {blocked ? (
                <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
                  This {noun} cannot be deleted yet, because other records still depend on it. Remove or reassign these first:
                </div>
              ) : (
                <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
                  This cannot be undone from the app. A copy of the record is kept for 90 days in case it has to be restored.
                </div>
              )}
              <ImpactList title="Still in use by" rows={impact.blocked} tone="#a13f3f" />
              <ImpactList title="Will also be deleted" rows={impact.deleted} tone="#a13f3f" />
              <ImpactList title="Will be kept, but no longer linked to this record" rows={impact.unlinked} />
              {!blocked && (impact.deleted || []).length === 0 && (impact.unlinked || []).length === 0 && (
                <div style={{ fontSize: 13, marginTop: 10, color: 'var(--ink-soft)' }}>Nothing else is attached to it.</div>
              )}

              {!blocked && (
                <div style={{ marginTop: 16 }}>
                  <label style={{ fontSize: 12.5 }}>Type <strong>delete</strong> to confirm</label>
                  <input
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter' && canConfirm) { e.preventDefault(); confirmDelete(); } }}
                  />
                </div>
              )}
            </>
          )}

          <div className="section-actions" style={{ marginTop: 18, marginBottom: 0 }}>
            {preview && !blocked && (
              <button type="button" className="btn btn-sm btn-danger" disabled={!canConfirm} onClick={confirmDelete}>
                {busy ? 'Deleting…' : `Delete ${noun}`}
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={close} disabled={busy}>{blocked || !preview ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      </PopupModal>
    </>
  );
}
