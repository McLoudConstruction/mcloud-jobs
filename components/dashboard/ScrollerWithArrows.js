'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

export default function ScrollerWithArrows({ children, ariaLabel = 'items' }) {
  const scrollerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // A couple of px of slack — sub-pixel scroll widths on some devices
    // otherwise leave the "end" arrow visibly stuck on by a hair.
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    // Content can change size after mount (e.g. data finishes loading),
    // which changes whether there's anything to scroll to at all.
    const resizeObserver = new ResizeObserver(updateArrows);
    resizeObserver.observe(el);
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows, children]);

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
          without it, this element refuses to shrink below its children's
          combined width, so instead of scrolling internally the whole
          row (arrows included) grows wider than the viewport and the
          right-hand arrow ends up pushed off-screen. */}
      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', flex: 1, minWidth: 0, height: '100%' }}
      >
        {children}
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
