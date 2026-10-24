'use client';
import { recencyOf } from '../lib/contactRecency';

// A small green, yellow or red dot for how recently a person was contacted. The colour is never the
// only signal: hovering or tapping shows the words, and screen readers get the same text.
export default function RecencyDot({ lastAt, size = 10, style }) {
  const r = recencyOf(lastAt);
  return (
    <span
      className={`recency-dot recency-${r.level}`}
      role="img"
      aria-label={r.title}
      title={r.title}
      style={{ width: size, height: size, ...style }}
    />
  );
}
