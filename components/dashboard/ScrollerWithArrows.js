'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

// A horizontally-scrollable strip with its own prev/next arrow buttons,
// used anywhere a row of same-height items (weather hours/days, dashboard
// stat tiles, stage counts) would otherwise wrap into a cramped grid on a
// narrow screen. Everything stays reachable without ever scrolling the
// page itself — only this strip scrolls, and only in the direction that
// actually has more content.
//
// Correctness note: ResizeObserver on the scroll viewport itself does
// NOT fire when only its *content* (scrollWidth) changes — the viewport's
// own box stays the same size as the window doesn't resize. So this
// watches a separate inner "track" div that wraps the children instead;
// the track's box size IS the content's total width, and does fire
// ResizeObserver callbacks whenever items are added, removed, or change
// size (e.g. async data arriving after first mount).
export default function ScrollerWithArrows({ children, ariaLabel = 'items', gap = 10 }) {
  const scrollerRef = useRef(null);
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // A few px of slack — sub-pixel widths on some devices otherwise
    // leave an arrow visibly stuck on (or off) by a hair.
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
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, height: '100%' }}>
      {canScrollLeft && (
        <button
          type="button"
          aria-label={`Scroll ${ariaLabel} earlier`}
          onClick={() => scrollByPage(-1)}
          className="btn btn-sm"
          style={{ flexShrink: 0, padding: '10px 6px' }}
        >‹</button>
      )}

      {/* minWidth: 0 overrides the flex-item default of min-width: auto —
          without it this element refuses to shrink below its children's
          combined width, so instead of scrolling internally the whole
          row (arrows included) grows wider than the viewport. */}
      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', flex: 1, minWidth: 0, height: '100%' }}
      >
        <div ref={trackRef} style={{ display: 'flex', gap, height: '100%' }}>
          {children}
        </div>
      </div>

      {canScrollRight && (
        <button
          type="button"
          aria-label={`Scroll ${ariaLabel} later`}
          onClick={() => scrollByPage(1)}
          className="btn btn-sm"
          style={{ flexShrink: 0, padding: '10px 6px' }}
        >›</button>
      )}
    </div>
  );
}
