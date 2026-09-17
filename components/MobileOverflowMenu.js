'use client';
import { useState } from 'react';

// A small "⋯" trigger for secondary/setup actions that don't belong on a
// mobile page's FAB (e.g. Add column). Wraps whatever's passed as
// children — including another component's own trigger button, like
// AddColumnButton — and closes itself on any click inside.
export default function MobileOverflowMenu({ children, label = 'More actions' }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-overflow-wrap">
      <button
        type="button"
        className="btn btn-sm mobile-overflow-btn"
        aria-label={label}
        onClick={() => setOpen(v => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="mobile-overflow-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
