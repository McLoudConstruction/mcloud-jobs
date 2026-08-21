'use client';
import { useState, useRef, useLayoutEffect } from 'react';

export default function FitText({ children, maxFontSize = 24, minFontSize = 12, style, className }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    let size = maxFontSize;
    text.style.fontSize = size + 'px';
    // Shrink in whole-pixel steps until the full text fits the
    // available width, or we hit the floor — it never gets cut off,
    // only smaller.
    while (text.scrollWidth > container.clientWidth && size > minFontSize) {
      size -= 1;
      text.style.fontSize = size + 'px';
    }
    setFontSize(size);
  }, [children, maxFontSize, minFontSize]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', overflow: 'hidden', ...style }}>
      <span ref={textRef} style={{ fontSize, fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-block' }}>{children}</span>
    </div>
  );
}
