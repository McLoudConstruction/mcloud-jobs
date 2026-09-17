'use client';
import { useState } from 'react';

// A single floating "+" for a mobile page's primary create action(s).
// items: [{ label, onClick, primary? }] — with one item, tapping the FAB
// fires it directly (no menu). With more than one, tapping the FAB opens
// a small stack of full-size buttons above it; `primary` puts an item at
// the top of that stack in the accent color.
export default function MobileFab({ items, label = 'Add' }) {
  const [open, setOpen] = useState(false);
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return null;

  function handleFabClick() {
    if (list.length === 1) {
      list[0].onClick();
      return;
    }
    setOpen(v => !v);
  }

  const sorted = list.length > 1 ? [...list].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)) : list;

  return (
    <div className="mobile-fab-wrap">
      {open && list.length > 1 && (
        <div className="mobile-fab-menu">
          {sorted.map((item, i) => (
            <button
              key={item.label}
              className={`btn mobile-fab-menu-item ${item.primary || i === 0 ? 'btn-primary' : ''}`}
              onClick={() => { setOpen(false); item.onClick(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="mobile-fab"
        aria-label={open ? 'Close menu' : label}
        onClick={handleFabClick}
      >
        {open && list.length > 1 ? '×' : '+'}
      </button>
    </div>
  );
}
