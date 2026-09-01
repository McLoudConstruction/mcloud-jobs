'use client';
import { useState } from 'react';
import PopupModal from './PopupModal';
import { CUSTOM_COLUMN_FIELD_TYPES, CUSTOM_COLUMN_FIELD_TYPE_LABELS } from '../lib/customColumns';

// A "+ Add column" trigger and its little form. Given an addColumn
// function (from useCustomColumns), this handles the label/type/options
// inputs and surfaces any error (e.g. a blank name) without the parent
// page needing to know anything about the form itself.
export default function AddColumnButton({ addColumn }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [optionsText, setOptionsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setLabel('');
    setFieldType('text');
    setOptionsText('');
    setError('');
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await addColumn({
        label,
        fieldType,
        options: optionsText.split(',').map(o => o.trim()).filter(Boolean),
      });
      close();
    } catch (err) {
      setError(err.message || 'Could not add that column.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>+ Add column</button>
      <PopupModal open={open} onClose={close} maxWidth={420}>
        <h3>New column</h3>
        <form onSubmit={submit}>
          <label>Column name *</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. License Number" required autoFocus />

          <label style={{ marginTop: 12 }}>Type</label>
          <select value={fieldType} onChange={e => setFieldType(e.target.value)}>
            {CUSTOM_COLUMN_FIELD_TYPES.map(t => <option key={t} value={t}>{CUSTOM_COLUMN_FIELD_TYPE_LABELS[t]}</option>)}
          </select>

          {fieldType === 'dropdown' && (
            <>
              <label style={{ marginTop: 12 }}>Options (comma-separated)</label>
              <input value={optionsText} onChange={e => setOptionsText(e.target.value)} placeholder="e.g. Yes, No, Pending" />
            </>
          )}

          {error && <div style={{ color: '#a13f3f', fontSize: 12.5, marginTop: 10 }}>{error}</div>}

          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add column'}</button>
          </div>
        </form>
      </PopupModal>
    </>
  );
}
