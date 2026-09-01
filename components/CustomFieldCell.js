'use client';
import { useState, useEffect } from 'react';

// Renders one cell of a custom column, matched to its field_type, and
// saves on blur (or immediately for a dropdown/date, since those changes
// are already a deliberate single action rather than mid-keystroke text).
export default function CustomFieldCell({ column, value, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  async function commit(next) {
    if (next === (value ?? '')) return; // nothing changed — skip the write
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  const commonProps = {
    onClick: e => e.stopPropagation(),
    disabled: saving,
    style: { width: '100%', fontSize: 13, padding: '4px 6px' },
  };

  if (column.field_type === 'dropdown') {
    return (
      <select {...commonProps} value={draft} onChange={e => { setDraft(e.target.value); commit(e.target.value); }}>
        <option value="">—</option>
        {(column.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (column.field_type === 'date') {
    return (
      <input
        {...commonProps}
        type="date"
        value={draft || ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
      />
    );
  }

  if (column.field_type === 'number') {
    return (
      <input
        {...commonProps}
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
      />
    );
  }

  return (
    <input
      {...commonProps}
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
    />
  );
}
