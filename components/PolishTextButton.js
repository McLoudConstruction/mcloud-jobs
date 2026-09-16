'use client';
import { useState } from 'react';

// Drop-in AI cleanup button for a text field. It doesn't own the field —
// it just fetches a grammar-cleaned version of `value` and hands it back
// via onPolished, so the field stays a normal, fully editable input the
// person can adjust afterward. Nothing here saves anything.
export default function PolishTextButton({ value, onPolished, disabled, label = '✦ Polish' }) {
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState('');

  async function polish() {
    if (!value || !value.trim() || polishing) return;
    setPolishing(true);
    setError('');
    try {
      const res = await fetch('/api/polish-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to polish text.');
      onPolished(data.polished);
    } catch (err) {
      setError(err.message);
      setTimeout(() => setError(''), 6000);
    } finally {
      setPolishing(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={polish}
        disabled={disabled || polishing || !value?.trim()}
        title="Clean up grammar and spelling — you can still edit after"
      >
        {polishing ? 'Polishing…' : label}
      </button>
      {error && <span style={{ fontSize: 11, color: '#a13f3f' }}>{error}</span>}
    </span>
  );
}
