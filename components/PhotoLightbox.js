'use client';
import { useMemo } from 'react';
import PhotoViewer from './PhotoViewer';

// Kept so existing callers (sub portal RFP page) work unchanged: takes plain
// URL strings and shows them in the shared PhotoViewer.
export default function PhotoLightbox({ photos, index, onClose, onNavigate }) {
  const items = useMemo(
    () => (photos || []).map((url, i) => ({ key: `${i}-${url}`, thumb: url, full: url })),
    [photos]
  );
  return <PhotoViewer items={items} index={index} onClose={onClose} onNavigate={onNavigate} />;
}
