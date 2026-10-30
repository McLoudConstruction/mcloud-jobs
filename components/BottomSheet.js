'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// A generic slide-up sheet anchored to the bottom of the screen — the
// mobile-native counterpart to PopupModal's centered dialog. Used for the
// bottom nav's "More" destinations today; built generic (title + children)
// so the Subcontractors "Filter" sheet and anything similar later can
// reuse it rather than inventing another one-off overlay.
//
// Drag to close: the handle and title are always a drag zone. Anything in
// the children marked data-sheet-drag (the Sections sheet marks its customer
// header) is one too. Dragging down moves the sheet with the finger; letting
// go past a distance, or with a quick flick, closes it, otherwise it springs
// back. A plain tap on a link inside a drag zone still works, because the
// drag only starts after the finger has moved a few pixels.
const CLOSE_DISTANCE = 90;   // px dragged down before release closes it
const CLOSE_VELOCITY = 0.6;  // px/ms flick that closes it from any distance
const DRAG_START = 6;        // px of movement before a touch counts as a drag

export default function BottomSheet({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  function setOffset(y, animate) {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.2s ease' : 'none';
    el.style.transform = y ? `translateY(${y}px)` : '';
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.target.closest('.bottom-sheet-handle, .bottom-sheet-title, [data-sheet-drag]')) return;
    drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, dy: 0, active: false };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_START) return;
      d.active = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.dy = Math.max(0, dy);   // never pull the sheet up past its resting place
    setOffset(d.dy, false);
  }

  function onPointerEnd(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    // The browser fires a click after a drag that ends on a link; ignore it.
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    if (e.type === 'pointercancel') { setOffset(0, true); return; }
    if (d.dy > CLOSE_DISTANCE || d.v > CLOSE_VELOCITY) {
      const h = sheetRef.current ? sheetRef.current.offsetHeight : 600;
      setOffset(h, true);
      setTimeout(onClose, 180);
    } else {
      setOffset(0, true);
    }
  }

  return createPortal(
    <div className="bottom-sheet-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="bottom-sheet"
        onClick={e => {
          e.stopPropagation();
          if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; }
        }}
        onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        {title && <div className="bottom-sheet-title">{title}</div>}
        {children}
      </div>
    </div>,
    document.body
  );
}
