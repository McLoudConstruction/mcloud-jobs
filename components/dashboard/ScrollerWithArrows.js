'use client';
import { useRef } from 'react';

// A horizontally-scrollable strip with its own prev/next arrow buttons,
// used anywhere a row of same-height items (weather hours/days, dashboard
// stat tiles, stage counts) would otherwise wrap into a cramped grid on a
// narrow screen. Everything stays reachable without ever scrolling the
// page itself — only this strip scrolls.
//
// Both arrows are always rendered, unconditionally, and never disabled or
// hidden at the ends. Earlier versions tried to detect scroll position
// (via scrollWidth/clientWidth, then ResizeObserver on a content "track")
// to grey out or remove an arrow once there was nothing left in that
// direction — that measurement kept coming back wrong in practice, which
// meant arrows silently failing to appear at all, and a hidden-but-still-
// reserving-space arrow left an unexplained gap at the start of every
// strip. Tapping an arrow with nothing left to scroll to is a harmless
// no-op; that's a small enough UX cost for arrows that are guaranteed to
// actually be there and actually work.
export default function ScrollerWithArrows({ children, ariaLabel = 'items', gap = 10 }) {
  const scrollerRef = useRef(null);

  function scrollByPage(direction) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: '100%', width: '100%', minWidth: 0, maxWidth: '100%' }}>
      <button
        type="button"
        aria-label={`Scroll ${ariaLabel} earlier`}
        onClick={() => scrollByPage(-1)}
        className="btn btn-sm"
        style={{ flexShrink: 0, padding: '10px 6px' }}
      >‹</button>

      {/* minWidth: 0 overrides the flex-item default of min-width: auto —
          without it this element refuses to shrink below its children's
          combined width, so instead of scrolling internally the whole
          row (arrows included) grows wider than the viewport. */}
      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        style={{ display: 'flex', gap, overflowX: 'auto', scrollSnapType: 'x mandatory', flex: '1 1 0%', minWidth: 0, maxWidth: '100%', height: '100%' }}
      >
        {children}
      </div>

      <button
        type="button"
        aria-label={`Scroll ${ariaLabel} later`}
        onClick={() => scrollByPage(1)}
        className="btn btn-sm"
        style={{ flexShrink: 0, padding: '10px 6px' }}
      >›</button>
    </div>
  );
}
