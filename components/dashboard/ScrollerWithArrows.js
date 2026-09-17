'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

// A horizontally-scrollable strip with its own prev/next arrow buttons,
// used anywhere a row of same-height items (weather hours/days, dashboard
// stat tiles, stage counts) would otherwise wrap into a cramped grid on a
// narrow screen. Everything stays reachable without ever scrolling the
// page itself — only this strip scrolls.
//
// Both arrow buttons are always rendered (never conditionally unmounted)
// and just disable themselves at each end. Two reasons: it keeps the
// strip's own layout constant from the very first paint — nothing shifts
// size when an arrow would otherwise appear/disappear — and it means a
// broken overflow measurement fails safe (a merely-greyed-out arrow)
// instead of failing to render navigation at all.
export default function ScrollerWithArrows({ children, ariaLabel = 'items', gap = 10 }) {
  const scrollerRef = useRef(null);
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    const resizeObserver = new ResizeObserver(updateArrows);
    resizeObserver.observe(el);
    resizeObserver.observe(track);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      resizeObserver.disconnect();
    };
  }, [updateArrows]);

  function scrollByPage(direction) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, height: '100%', maxWidth: '100%' }}>
      <button
        type="button"
        aria-label={`Scroll ${ariaLabel} earlier`}
        onClick={() => scrollByPage(-1)}
        disabled={!canScrollLeft}
        className="btn btn-sm"
        style={{ flexShrink: 0, padding: '10px 6px', visibility: canScrollLeft ? 'visible' : 'hidden' }}
      >‹</button>

      {/* minWidth: 0 overrides the flex-item default of min-width: auto —
          without it this element refuses to shrink below its children's
          combined width, so instead of scrolling internally the whole
          row (arrows included) grows wider than the viewport. */}
      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', flex: '1 1 0%', minWidth: 0, maxWidth: '100%', height: '100%' }}
      >
        <div ref={trackRef} style={{ display: 'flex', gap, height: '100%' }}>
          {children}
        </div>
      </div>

      <button
        type="button"
        aria-label={`Scroll ${ariaLabel} later`}
        onClick={() => scrollByPage(1)}
        disabled={!canScrollRight}
        className="btn btn-sm"
        style={{ flexShrink: 0, padding: '10px 6px', visibility: canScrollRight ? 'visible' : 'hidden' }}
      >›</button>
    </div>
  );
}
