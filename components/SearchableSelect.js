'use client';
import { useState, useRef, useEffect } from 'react';

// A text input that filters `options` ([{ id, label, sublabel?, group? }])
// as you type and shows the matches in a dropdown below. Picking one sets
// the field and closes the list; the field then shows the picked label.
// Built for the Calendar page's Project field (a search across leads,
// opportunities, and jobs) but generic enough to reuse anywhere a plain
// <select> would be too long to scroll.
export default function SearchableSelect({ options, value, onChange, placeholder = 'Search…', allowClear = true }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = options.find(o => o.id === value) || null;

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || (o.sublabel || '').toLowerCase().includes(q))
    : options;

  function pick(opt) {
    onChange(opt ? opt.id : '');
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {!open && selected ? (
        <div
          onClick={() => setOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '9px 12px', border: '1px solid var(--panel-line)', borderRadius: 6,
            background: 'var(--card-bg)', cursor: 'pointer', fontSize: 13.5,
          }}
        >
          <span>
            {selected.label}
            {selected.sublabel && <span style={{ color: 'var(--ink-soft)' }}> — {selected.sublabel}</span>}
          </span>
          {allowClear && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); pick(null); }}
              aria-label="Clear"
              style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 15, padding: 0 }}
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <input
          autoFocus={open}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
        />
      )}

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxHeight: 220, overflowY: 'auto',
          }}
        >
          {matches.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink-soft)' }}>No matches.</div>
          )}
          {matches.map(o => (
            <div
              key={o.id}
              onClick={() => pick(o)}
              style={{ padding: '9px 12px', fontSize: 13.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
              onMouseDown={e => e.preventDefault()}
            >
              <div>{o.label}</div>
              {(o.sublabel || o.group) && (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{[o.group, o.sublabel].filter(Boolean).join(' — ')}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
