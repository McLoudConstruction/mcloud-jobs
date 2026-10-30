'use client';
import { useEffect, useRef, useState } from 'react';

// An "Actions" button that opens a small dropdown of secondary actions (imports,
// exports, add column). Items: [{ label, onClick, disabled? }]; label may be a
// function, called each time the menu renders. The menu
// closes after a pick, on an outside click, or on Escape. Anything an item
// opens (a file picker, a popup) must be rendered by the page itself, not
// inside this menu, since the menu unmounts when it closes.
export default function ActionsMenu({ items, label = 'More actions' }) {
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

  return (
    <div className="actions-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn actions-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(v => !v)}
      >
        Actions
        <svg className="menu-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="actions-menu" role="menu">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="actions-menu-item"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
            >
              {typeof item.label === 'function' ? item.label() : item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
