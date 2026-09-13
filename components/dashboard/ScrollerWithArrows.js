'use client';
import { useRef } from 'react';

export default function ScrollerWithArrows({ children, ariaLabel = 'items' }) {
  const scrollerRef = useRef(null);

  function scrollByPage(direction) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, height: '100%' }}>
      <button
        type="button"
        aria-label={`Scroll ${ariaLabel} earlier`}
        onClick={() => scrollByPage(-1)}
        className="btn btn-sm"
        style={{ flexShrink: 0, padding: '10px 6px' }}
      >‹</button>

      <div ref={scrollerRef} className="hide-scrollbar" style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', flex: 1, height: '100%' }}>
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
