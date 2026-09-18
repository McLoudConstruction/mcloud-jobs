'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// A generic slide-up sheet anchored to the bottom of the screen — the
// mobile-native counterpart to PopupModal's centered dialog. Used for the
// bottom nav's "More" destinations today; built generic (title + children)
// so the Subcontractors "Filter" sheet and anything similar later can
// reuse it rather than inventing another one-off overlay.
export default function BottomSheet({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="bottom-sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="bottom-sheet-handle" aria-hidden="true" />
        {title && <div className="bottom-sheet-title">{title}</div>}
        {children}
      </div>
    </div>,
    document.body
  );
}
