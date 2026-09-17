'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Wraps a horizontally-scrollable row (tabs, chips, month pickers) and adds
// a fade cue at whichever edge still has more content — the "peeking chip"
// affordance from the mobile redesign guide. Without this, a row that
// scrolls fine still *reads* as simply clipped (see: the Sales page's
// "Rout..." tab). Purely presentational — it doesn't change the row's own
// classes/scrolling, only overlays two edge masks that show/hide based on
// actual scroll position, so the cue disappears once there's nothing left
// to reveal in that direction.
export default function ScrollFadeRow({ children, trackClassName = '', wrapClassName = '' }) {
  const ref = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 4);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Tab/chip labels can arrive after mount (e.g. counts loading from a
    // query), which changes scrollWidth without firing scroll or resize —
    // re-measure shortly after too, not just on those two events.
    const t = setTimeout(update, 200);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, children]);

  return (
    <div className={`scroll-fade-wrap ${wrapClassName}`}>
      <div className={`scroll-fade-track ${trackClassName}`} ref={ref}>
        {children}
      </div>
      {showLeft && <div className="scroll-fade-edge scroll-fade-left" aria-hidden="true" />}
      {showRight && <div className="scroll-fade-edge scroll-fade-right" aria-hidden="true" />}
    </div>
  );
}
