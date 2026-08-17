'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PROPERTY_TYPES } from '../lib/constants';

export default function RouteBuilderModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [zip, setZip] = useState('');
  const [stops, setStops] = useState('10');
  const [types, setTypes] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitted(true);
  }

  function handleClose() {
    setSubmitted(false);
    setZip('');
    setStops('10');
    setTypes([]);
    onClose();
  }

  return createPortal(
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Create My Sales Route</h3>

        {submitted ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '10px 0 18px' }}>
              Got it — {stops} stops around {zip || 'your area'}, focused on: {types.length ? types.join(', ') : 'any property type'}.
              Route generation itself is coming in a future update — for now this saves your criteria so it's ready to go the moment that's built.
            </p>
            <button className="btn btn-sm" onClick={handleClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
              Tell me where you're working and what you're looking for, and I'll put together a route.
            </p>

            <label>ZIP code or area</label>
            <input value={zip} onChange={e => setZip(e.target.value)} placeholder="e.g. 64133 or Raytown" required />

            <label style={{ marginTop: 12 }}>Number of stops</label>
            <input type="number" min="1" value={stops} onChange={e => setStops(e.target.value)} />

            <label style={{ marginTop: 12 }}>Property types to include</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {PROPERTY_TYPES.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={types.includes(t)} onChange={() => toggleType(t)} />
                  {t}
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary btn-sm" type="submit">Build Route</button>
              <button className="btn btn-sm" type="button" onClick={handleClose}>Cancel</button>
            </div>
          </form>
        )}
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
  background: '#fff', borderRadius: 8, padding: 26, width: '100%', maxWidth: 440,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
};
