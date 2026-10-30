'use client';
import { useEffect, useRef, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Small map with one pin for a lead's address. The address is geocoded with
// Mapbox (same token the Route Builder uses). Renders nothing when there is
// no address; shows a short note instead of a map when the token is missing
// or the address cannot be found, so the popup never breaks.
export default function LeadMap({ address, height = 220 }) {
  const divRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | notoken

  useEffect(() => {
    const q = (address || '').trim();
    if (!q) return undefined;
    if (!TOKEN) { setStatus('notoken'); return undefined; }
    let cancelled = false;
    let map = null;
    const ctrl = new AbortController();
    setStatus('loading');
    (async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&limit=1&country=us&autocomplete=false&access_token=${TOKEN}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) throw new Error('geocode');
        const data = await res.json();
        const c = data.features?.[0]?.geometry?.coordinates;
        if (cancelled) return;
        if (!Array.isArray(c) || c.length < 2) { setStatus('notfound'); return; }
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !divRef.current) return;
        mapboxgl.accessToken = TOKEN;
        map = new mapboxgl.Map({
          container: divRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: c,
          zoom: 14,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
        new mapboxgl.Marker({ color: '#a13f3f' }).setLngLat(c).addTo(map);
        setStatus('ready');
      } catch (e) {
        if (!cancelled && e.name !== 'AbortError') setStatus('notfound');
      }
    })();
    return () => { cancelled = true; ctrl.abort(); if (map) map.remove(); };
  }, [address]);

  if (!(address || '').trim()) return null;

  return (
    <div>
      <div style={{ position: 'relative', height, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--panel)' }}>
        <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
        {status !== 'ready' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16, fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {status === 'loading' && 'Loading map…'}
            {status === 'notfound' && 'Could not find this address on the map.'}
            {status === 'notoken' && 'Map needs NEXT_PUBLIC_MAPBOX_TOKEN set in Vercel.'}
          </div>
        )}
      </div>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
        target="_blank" rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--ink-soft)' }}
      >
        Open in Maps ↗
      </a>
    </div>
  );
}
