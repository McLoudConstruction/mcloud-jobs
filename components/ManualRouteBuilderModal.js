'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ManualRouteBuilderCore from './ManualRouteBuilderCore';

// Same thin modal chrome as RouteBuilderModal, wrapping the manual
// builder instead of the AI one — used by both Dashboard's and Sales's
// "Create Sales Route" buttons.
export default function ManualRouteBuilderModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div className="route-modal-card-wrap">
          <ManualRouteBuilderCore onClose={onClose} />
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
  width: '100%', maxWidth: 560,
  margin: 'auto',
  filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.25))',
};
