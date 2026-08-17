'use client';
import { useState, useEffect } from 'react';

function isValidHex(v) { return /^#[0-9a-fA-F]{6}$/.test(v); }

export default function ColorField({ label, id, value, fallback, onChange }) {
  const safe = isValidHex(value) ? value : fallback;
  const [hexText, setHexText] = useState(safe);

  useEffect(() => { setHexText(safe); }, [safe]);

  function handleSwatch(v) {
    onChange(v);
    setHexText(v);
  }
  function handleHexInput(v) {
    let next = v.trim();
    if (next && !next.startsWith('#')) next = '#' + next;
    setHexText(next);
    if (isValidHex(next)) onChange(next);
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={id} type="color" value={safe} onChange={e => handleSwatch(e.target.value)} style={{ height: 42, width: 48, padding: 4, flexShrink: 0 }} />
        <input
          type="text"
          value={hexText}
          onChange={e => handleHexInput(e.target.value)}
          placeholder="#000000"
          maxLength={7}
          style={{ fontFamily: 'monospace', textTransform: 'lowercase' }}
        />
      </div>
    </div>
  );
}
