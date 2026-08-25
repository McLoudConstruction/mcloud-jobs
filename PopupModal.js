'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function PopupModal({ open, onClose, maxWidth = 640, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="send-doc-overlay" style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" style={closeButtonStyle}>×</button>
        {children}
      </div>
    </div>,
    document.body
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto', position: 'relative',
};
const closeButtonStyle = {
  position: 'absolute', top: 10, right: 14,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 26, lineHeight: 1, color: 'var(--ink-soft)', padding: 4,
};
