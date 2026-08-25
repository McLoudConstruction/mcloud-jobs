'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import RouteBuilderCore from './RouteBuilderCore';

// Thin modal chrome around RouteBuilderCore — used by the Dashboard's
// popup entry point. The real content lives in RouteBuilderCore so the
// same functionality can also render as a plain page (Sales > Route
// Builder) without looking like a popup that wandered onto a page.
export default function RouteBuilderModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div className="route-modal-card-wrap">
          <RouteBuilderCore onClose={onClose} />
        </div>
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
  width: '100%', maxWidth: 480,
  margin: 'auto',
  filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.25))',
};
