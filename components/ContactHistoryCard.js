'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  MIGRATION_HINT, loadContactHistory, saveHistoryEntry, deleteHistoryEntry,
  dateToMonth, formatRange, jobTitle,
} from '../lib/contactHistory';

// Where this person has worked before, newest first, on the right side of the Person popup.
//
// Their current job stays in the form on the left. It is repeated here as the first row so the card
// reads as one timeline. Past jobs can be added, changed and removed while the contact is being edited.
// When a person's company or position changes, the Person page offers to log the old job here.

const EMPTY_DRAFT = { company_name: '', position: '', property_name: '', started_month: '', ended_month: '', note: '' };

export default function ContactHistoryCard({ contactId, canEdit, current, reloadKey }) {
  const [rows, setRows] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false); // adding a new job
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!contactId) { setRows([]); return; }
    const res = await loadContactHistory(contactId);
    setMissing(Boolean(res.missing));
    setLoadError(res.error || '');
    setRows(res.rows);
  }, [contactId]);

  useEffect(() => {
    setRows(null); setFormOpen(false); setEditingEntryId(null); setDraft(EMPTY_DRAFT);
    setMessage(''); setError('');
    load();
  }, [load, reloadKey]);

  // Leaving edit mode closes any open form.
  useEffect(() => {
    if (!canEdit) { setFormOpen(false); setEditingEntryId(null); setError(''); }
  }, [canEdit]);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(''), 3500);
  }

  function setField(field, value) {
    setDraft(prev => ({ ...prev, [field]: value }));
  }

  function openAdd() {
    setEditingEntryId(null); setDraft(EMPTY_DRAFT); setFormOpen(true); setError('');
  }

  function openEdit(entry) {
    setFormOpen(false);
    setEditingEntryId(entry.id);
    setDraft({
      company_name: entry.company_name || '',
      position: entry.position || '',
      property_name: entry.property_name || '',
      started_month: dateToMonth(entry.started_on),
      ended_month: dateToMonth(entry.ended_on),
      note: entry.note || '',
    });
    setError('');
  }

  function closeForm() {
    setFormOpen(false); setEditingEntryId(null); setDraft(EMPTY_DRAFT); setError('');
  }

  async function save() {
    setBusy(true); setError('');
    const res = await saveHistoryEntry(contactId, draft, editingEntryId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    const wasEditing = Boolean(editingEntryId);
    closeForm();
    flash(wasEditing ? 'Job updated.' : 'Job added to history.');
    await load();
  }

  async function remove(entry) {
    if (!confirm(`Remove ${jobTitle(entry)} from this person's history?`)) return;
    setBusy(true); setError('');
    const res = await deleteHistoryEntry(entry.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    if (editingEntryId === entry.id) closeForm();
    flash('Removed from history.');
    await load();
  }

  if (!contactId) return null;

  const hasCurrent = Boolean((current?.company || '').trim() || (current?.position || '').trim());
  const count = rows ? rows.length : 0;

  const form = (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, margin: '8px 0' }}>
      <div className="two-col">
        <div>
          <label style={{ marginTop: 0 }}>Company</label>
          <input autoFocus value={draft.company_name} onChange={e => setField('company_name', e.target.value)} placeholder="Where they worked" />
        </div>
        <div>
          <label style={{ marginTop: 0 }}>Position</label>
          <input value={draft.position} onChange={e => setField('position', e.target.value)} placeholder="e.g. Property Manager" />
        </div>
      </div>
      <label>Property or portfolio</label>
      <input value={draft.property_name} onChange={e => setField('property_name', e.target.value)} placeholder="Optional" />
      <div className="two-col">
        <div>
          <label>Started</label>
          <input type="month" value={draft.started_month} onChange={e => setField('started_month', e.target.value)} />
        </div>
        <div>
          <label>Ended</label>
          <input type="month" value={draft.ended_month} onChange={e => setField('ended_month', e.target.value)} />
        </div>
      </div>
      <label>Notes</label>
      <textarea
        value={draft.note}
        onChange={e => setField('note', e.target.value)}
        placeholder="Who they worked with, why they left, anyone you both know"
        style={{ minHeight: 70 }}
      />
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
      <div className="section-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : (editingEntryId ? 'Save job' : 'Add job')}</button>
        <button type="button" className="btn btn-sm" onClick={closeForm} disabled={busy}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="contact-history-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h4 style={{ margin: 0 }}>Contact history{rows && count > 0 ? ` (${count})` : ''}</h4>
        {canEdit && !missing && !formOpen && (
          <button type="button" className="btn btn-sm" onClick={openAdd} disabled={busy}>+ Add past job</button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '2px 0 6px' }}>
        {canEdit
          ? 'Where they have worked before. Their current job is in the form.'
          : 'Where they have worked before. Press Edit Contact to add or change jobs.'}
      </div>

      {missing && <div style={{ fontSize: 12.5, color: '#a13f3f' }}>{MIGRATION_HINT}</div>}
      {loadError && <div style={{ fontSize: 12.5, color: '#a13f3f' }}>{loadError}</div>}
      {rows === null && !missing && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}

      {!missing && rows !== null && (
        <>
          {formOpen && form}

          {hasCurrent && (
            <div style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#3A6B45', marginRight: 8 }}>Current</span>
                {jobTitle({ company_name: current.company, position: current.position })}
              </div>
              {(current.property || '').trim() && (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>{current.property}</div>
              )}
            </div>
          )}

          {rows.length === 0 && !formOpen && (
            <div className="empty-state" style={{ marginTop: 8 }}>
              No past jobs logged yet. Add where they worked before. Notes like who they worked with give you something to start a conversation with.
            </div>
          )}

          {rows.map(entry => (
            editingEntryId === entry.id ? (
              <div key={entry.id}>{form}</div>
            ) : (
              <div key={entry.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{jobTitle(entry)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
                      {formatRange(entry.started_on, entry.ended_on)}{entry.property_name ? `  ·  ${entry.property_name}` : ''}
                    </div>
                    {entry.note && <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 4 }}>{entry.note}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <button type="button" className="btn btn-sm" onClick={() => openEdit(entry)} disabled={busy}>Edit</button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(entry)} disabled={busy}>Remove</button>
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
        </>
      )}

      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 8 }}>{message}</div>}
      {!formOpen && !editingEntryId && error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
