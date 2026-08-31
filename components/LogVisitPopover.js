'use client';
import { useEffect, useRef, useState } from 'react';

// Normalizes to noon local time before converting to ISO, so a
// "Yesterday" or calendar-picked date doesn't shift to the wrong day
// once it round-trips through UTC storage and back to a displayed date.
function isoForDate(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export default function LogVisitPopover({ onLog, label = 'Mark Visited' }) {
  const [open, setOpen] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function pick(iso) {
    onLog(iso);
    setOpen(false);
    setCustomDate('');
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(o => !o)}>{label}</button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
            background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 6,
            minWidth: 190, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', padding: 10,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => pick(isoForDate(new Date()))}>Today</button>
            <button type="button" className="btn btn-sm" onClick={() => pick(isoForDate(new Date(Date.now() - 86400000)))}>Yesterday</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 13 }}>📅</span>
              <input
                type="date"
                value={customDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => {
                  setCustomDate(e.target.value);
                  if (e.target.value) pick(isoForDate(new Date(e.target.value + 'T12:00:00')));
                }}
                style={{ flex: 1, fontSize: 12.5, padding: '5px 7px' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
