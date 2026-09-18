'use client';
import { useRef, useState } from 'react';

const SWIPE_THRESHOLD = 64;
const MAX_SWIPE = 88;

// A generic swipe-to-act row: drag right reveals a "mark read" action behind
// the left edge, drag left reveals a "dismiss" action behind the right edge.
// Pass only the handler(s) a given row actually supports (e.g. a message
// thread has no "dismiss" concept) and that side simply won't respond.
// Built generic — content is passed as children — so it isn't tied to the
// Inbox feed specifically; any mobile list wanting standard swipe gestures
// instead of always-visible button pairs can reuse it.
export default function SwipeableRow({ children, onMarkRead, markReadLabel = 'Mark read', onDismiss, dismissLabel = 'Dismiss' }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });
  const axis = useRef(null);

  function handleTouchStart(e) {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    axis.current = null;
    setDragging(true);
  }

  function handleTouchMove(e) {
    const dx = e.touches[0].clientX - start.current.x;
    const dy = e.touches[0].clientY - start.current.y;
    if (axis.current === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    // Not a horizontal drag — let the page scroll normally.
    if (axis.current !== 'x') return;
    e.preventDefault();
    let next = dx;
    if (next > 0 && !onMarkRead) next = 0;
    if (next < 0 && !onDismiss) next = 0;
    next = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, next));
    setDragX(next);
  }

  function handleTouchEnd() {
    setDragging(false);
    if (dragX >= SWIPE_THRESHOLD && onMarkRead) onMarkRead();
    else if (dragX <= -SWIPE_THRESHOLD && onDismiss) onDismiss();
    setDragX(0);
  }

  return (
    <div className="swipe-row">
      <div className="swipe-row-actions">
        {onMarkRead && <span className="swipe-row-action swipe-row-action-read">{markReadLabel}</span>}
        {onDismiss && <span className="swipe-row-action swipe-row-action-dismiss">{dismissLabel}</span>}
      </div>
      <div
        className="swipe-row-content"
        style={{ transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : 'transform 0.2s ease' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
