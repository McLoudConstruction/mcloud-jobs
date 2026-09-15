'use client';
import { useState, useRef, useCallback } from 'react';

// Touch-and-mouse-friendly drag-to-reorder for a flat list. Grab the
// handle, drag over another row, release to drop. Deliberately not the
// native HTML5 drag-and-drop API — it has no real touch support, and
// this app is used in the field on phones. Uses pointer capture on the
// handle itself so a dragging finger keeps sending events to it even
// after leaving the handle's own bounding box.
export function useDragReorder(items, onReorder) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const handlePointerDown = useCallback((e, index) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragIndex(index);
    setOverIndex(index);
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (dragIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest('[data-drag-row]');
    if (row) {
      const idx = Number(row.getAttribute('data-drag-row'));
      if (!Number.isNaN(idx)) setOverIndex(idx);
    }
  }, [dragIndex]);

  const handlePointerUp = useCallback((e) => {
    if (dragIndex === null) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setOverIndex(currentOver => {
      if (currentOver !== null && currentOver !== dragIndex) {
        const list = itemsRef.current.slice();
        const [moved] = list.splice(dragIndex, 1);
        list.splice(currentOver, 0, moved);
        onReorder(list);
      }
      return null;
    });
    setDragIndex(null);
  }, [dragIndex, onReorder]);

  return { dragIndex, overIndex, handlePointerDown, handlePointerMove, handlePointerUp };
}
