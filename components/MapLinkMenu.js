'use client';
import { useEffect, useRef, useState } from 'react';

// A plain https://google.com/maps link doesn't trigger the OS's "which
// maps app?" picker the way a native maps: URI does on most platforms —
// it just opens Google Maps directly. This gives people who prefer Apple
// Maps (or just want to choose per click) an explicit option instead.
export default function MapLinkMenu({ address, children, style, onMouseOver, onMouseOut }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!address) return null;
  const encoded = encodeURIComponent(address);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', ...style }}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
      >
        {children}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
            background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 6,
            minWidth: 170, boxShadow: '0 4px 14px rgba(0,0,0,0.15)', overflow: 'hidden',
          }}
        >
          <a
            href={`https://maps.apple.com/?q=${encoded}`}
            target="_blank" rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={{ display: 'block', padding: '9px 14px', fontSize: 12.5, color: 'var(--heading)', textDecoration: 'none' }}
          >
            Open in Apple Maps
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encoded}`}
            target="_blank" rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={{ display: 'block', padding: '9px 14px', fontSize: 12.5, color: 'var(--heading)', textDecoration: 'none', borderTop: '1px solid var(--line)' }}
          >
            Open in Google Maps
          </a>
        </div>
      )}
    </div>
  );
}
