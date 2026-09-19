'use client';
import { useEffect } from 'react';

// Full-screen viewer for a set of photo URLs, opened from an expandable
// thumbnail grid. Unlike the single-image lightbox pattern used
// elsewhere (job material selections), this one knows about every
// photo in the set so the viewer can step through them with the arrow
// buttons, the keyboard, or the counter — no closing and reopening a
// different thumbnail just to see the next photo.
export default function PhotoLightbox({ photos, index, onClose, onNavigate }) {
  const open = index !== null && index !== undefined && !!photos?.[index];

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && photos.length > 1) onNavigate((index + 1) % photos.length);
      else if (e.key === 'ArrowLeft' && photos.length > 1) onNavigate((index - 1 + photos.length) % photos.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, photos, onClose, onNavigate]);

  if (!open) return null;

  return (
    <div className="photo-lightbox-overlay no-print" onClick={onClose}>
      <div className="photo-lightbox-inner" onClick={e => e.stopPropagation()}>
        {photos.length > 1 && (
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-prev"
            onClick={() => onNavigate((index - 1 + photos.length) % photos.length)}
            aria-label="Previous photo"
          >‹</button>
        )}
        <img src={photos[index]} alt={`Photo ${index + 1} of ${photos.length}`} />
        {photos.length > 1 && (
          <button
            type="button"
            className="photo-lightbox-nav photo-lightbox-next"
            onClick={() => onNavigate((index + 1) % photos.length)}
            aria-label="Next photo"
          >›</button>
        )}
        <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close">×</button>
        {photos.length > 1 && <div className="photo-lightbox-counter">{index + 1} / {photos.length}</div>}
      </div>
    </div>
  );
}
