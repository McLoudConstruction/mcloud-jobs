'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon } from './photoIcons';

// In-app photo viewer. Fills the screen with the photo at near full
// resolution, steps with arrows, keys or a swipe, and tap-to-zoom.
//
// items   [{ key, thumb, full? }]   thumb shows instantly, full replaces it
// resolve optional (item) => Promise<string>  fetches the full-size URL
//         when item.full is not set yet (neighbors are prefetched)
export default function PhotoViewer({ items, index, onClose, onNavigate, footer }) {
  const open = index !== null && index !== undefined && !!items?.[index];
  const [resolved, setResolved] = useState({}); // key -> url
  const [zoomed, setZoomed] = useState(false);
  const touch = useRef(null);
  const wrapRef = useRef(null);

  const count = items?.length || 0;
  const go = useCallback(delta => {
    if (count < 2) return;
    setZoomed(false);
    onNavigate((index + delta + count) % count);
  }, [count, index, onNavigate]);

  // Lock page scroll behind the viewer.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go, onClose]);

  // Resolve the full-size URL for this photo and its neighbors.
  useEffect(() => {
    if (!open) return;
    [0, 1, -1].forEach(offset => {
      const item = items[(index + offset + count) % count];
      if (!item || item.full || resolved[item.key] || !item.resolve) return;
      item.resolve().then(url => {
        if (url) setResolved(prev => ({ ...prev, [item.key]: url }));
      }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, items]);

  if (!open) return null;
  const item = items[index];
  const src = item.full || resolved[item.key] || item.thumb;
  const loadingFull = !item.full && !resolved[item.key] && !!item.resolve;

  function onTouchStart(e) {
    if (zoomed || e.touches.length !== 1) { touch.current = null; return; }
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }

  return (
    <div className="pv-overlay no-print" role="dialog" aria-label="Photo viewer">
      <div className="pv-top">
        <div className="pv-counter">{index + 1} / {count}</div>
        <button type="button" className="pv-close" onClick={onClose} aria-label="Close viewer">
          <CloseIcon size={22} />
        </button>
      </div>

      <div
        ref={wrapRef}
        className={`pv-stage${zoomed ? ' is-zoomed' : ''}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          key={item.key}
          src={src}
          alt={`Photo ${index + 1} of ${count}`}
          className="pv-img"
          draggable={false}
          onClick={() => setZoomed(z => !z)}
        />
        {loadingFull && <div className="pv-loading">Loading full size</div>}
        {count > 1 && !zoomed && (
          <>
            <button type="button" className="pv-nav pv-prev" onClick={() => go(-1)} aria-label="Previous photo">
              <ChevronLeftIcon size={26} />
            </button>
            <button type="button" className="pv-nav pv-next" onClick={() => go(1)} aria-label="Next photo">
              <ChevronRightIcon size={26} />
            </button>
          </>
        )}
      </div>

      {footer && <div className="pv-footer">{typeof footer === 'function' ? footer(item, index) : footer}</div>}
    </div>
  );
}
