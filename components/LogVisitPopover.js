'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const popoverRef = useRef(null);

  // Rendered in a portal (not as a normal absolutely-positioned child) —
  // this button typically sits inside a DataTable, whose wrapper has
  // overflow-x: auto for horizontal scrolling. That clips any
  // absolutely-positioned popover that would render outside the table's
  // bounds, which is exactly what made this look "hidden": it was there,
  // just cut off by the scroll container. Portaling to <body> and
  // positioning with fixed coordinates escapes that entirely.
  function openPopover() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleReposition() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.right });
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open]);

  function pick(iso) {
    onLog(iso);
    setOpen(false);
    setCustomDate('');
  }

  return (
    <>
      <button type="button" ref={btnRef} className="btn btn-sm" onClick={() => (open ? setOpen(false) : openPopover())}>
        {label}
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed', top: coords.top, left: coords.left, transform: 'translateX(-100%)', zIndex: 1000,
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
        </div>,
        document.body
      )}
    </>
  );
}
