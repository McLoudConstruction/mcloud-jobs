'use client';
import { useEffect, useRef, useState } from 'react';

// A "Filters" button that opens a small dropdown of tick boxes, for list
// toggles like "Show inactive" that used to sit as loose checkboxes under the
// search bar. Options: [{ label, checked, onChange(next), hidden? }]. A
// hidden option is left out, and the whole button disappears when none are
// left. The count badge shows how many options are ticked. The menu stays open
// while you tick, and closes on an outside click or Escape.
export default function FilterMenu({ options, label = 'Filters' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = options.filter(o => !o.hidden);
  if (shown.length === 0) return null;
  const active = shown.filter(o => o.checked).length;

  return (
    <div className="actions-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn filter-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {label}
        {active > 0 && <span className="filter-menu-count">{active}</span>}
        <svg className="menu-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="actions-menu" role="menu">
          {shown.map(o => (
            <label key={o.label} className="filter-menu-item">
              <input type="checkbox" style={{ width: 'auto' }} checked={!!o.checked} onChange={e => o.onChange(e.target.checked)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
