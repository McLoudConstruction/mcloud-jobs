'use client';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '../../../../lib/useAuth';
import AppShell from '../../../../components/AppShell';
import { getRouteById, activateSavedRoute } from '../../../../lib/salesRoutes';
import { fetchDirections } from '../../../../lib/mapboxRoute';
import {
  DEFAULT_MAP_CENTER, formatStopAddress, formatMiles, formatDuration, metersToMiles, stopHasCoords,
} from '../../../../lib/mapRouteHelpers';
import {
  DEFAULT_DWELL_MINUTES, buildTimeline, routeStopsOf, legsByStop, timeStringToToday, formatClock, formatMinutes,
} from '../../../../lib/routeTiming';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const INK = '#1C1B19';
const BRASS = '#9B773D';
const EMPTY = { type: 'FeatureCollection', features: [] };

function pinElement(label, kind, title) {
  const el = document.createElement('div');
  el.textContent = label;
  if (title) el.title = title;
  const bg = kind === 'start' ? '#16a34a' : kind === 'visited' ? '#5a7d5a' : INK;
  el.style.cssText = [
    'width:28px', 'height:28px', 'border-radius:50%', 'box-sizing:border-box',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:700 12px/1 system-ui,sans-serif', 'color:#fff', `background:${bg}`,
    'border:2px solid #fff', 'box-shadow:0 2px 6px rgba(0,0,0,0.4)', 'cursor:pointer',
  ].join(';');
  return el;
}

// Route overview: the whole route on a map with the line highlighted, and
// the stops in a floating pane on the left. Opened from a saved route on the
// Dashboard or from Recent Routes. Start Driving makes a saved route the
// active one and opens Drive Mode.
export default function RouteOverviewPage() {
  const { session, loading } = useRequireAuth();
  const params = useParams();
  const router = useRouter();
  const routeId = params?.id;

  const [route, setRoute] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | missing
  const [error, setError] = useState('');
  const [road, setRoad] = useState(null); // { key, geometry, meters, seconds, legs }
  const [roadError, setRoadError] = useState('');
  const [roadBusy, setRoadBusy] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [starting, setStarting] = useState(false);
  const [paneMin, setPaneMin] = useState(false);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const mapboxRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);

  // ── Load the route ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session || !routeId) return undefined;
    let cancelled = false;
    getRouteById(routeId)
      .then(r => {
        if (cancelled) return;
        if (!r) { setPhase('missing'); return; }
        setRoute(r);
        setPhase('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Could not load this route.');
        setPhase('missing');
      });
    return () => { cancelled = true; };
  }, [session, routeId]);

  const stops = useMemo(() => route?.stops || [], [route]);
  const start = useMemo(
    () => (route && route.start_lat != null && route.start_lng != null
      ? { lat: Number(route.start_lat), lng: Number(route.start_lng) }
      : null),
    [route]
  );
  const routed = useMemo(() => routeStopsOf(stops), [stops]);
  const points = useMemo(
    () => [...(start ? [start] : []), ...routed.map(s => ({ lat: Number(s.property_lat), lng: Number(s.property_lng) }))],
    [start, routed]
  );
  const pointsKey = useMemo(() => points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';'), [points]);

  // ── Road route for the highlight line and per-leg times ────────────────
  useEffect(() => {
    if (phase !== 'ready' || !TOKEN || points.length < 2) { setRoad(null); return undefined; }
    const ctrl = new AbortController();
    setRoadBusy(true);
    setRoadError('');
    fetchDirections(points, TOKEN, ctrl.signal).then(({ route: r, error: err }) => {
      if (ctrl.signal.aborted) return;
      setRoadBusy(false);
      if (err) { setRoadError(err); setRoad(null); return; }
      setRoad(r ? { key: pointsKey, ...r } : null);
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pointsKey]);

  const defaultDwell = route?.default_dwell_minutes ?? DEFAULT_DWELL_MINUTES;
  const legs = road && road.legs && road.legs.length === points.length - 1 ? road.legs : null;
  const legByStop = useMemo(() => legsByStop(stops, legs, !!start), [stops, legs, start]);
  const timeline = useMemo(
    () => buildTimeline({
      stops, legs, hasStart: !!start, defaultDwell,
      departAt: timeStringToToday(route?.depart_time ? String(route.depart_time).slice(0, 5) : ''),
    }),
    [stops, legs, start, defaultDwell, route]
  );

  // ── Map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'ready' || !TOKEN) return undefined;
    let cancelled = false;
    let map = null;
    let ro = null;
    (async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      if (cancelled || !mapDivRef.current) return;
      mapboxgl.accessToken = TOKEN;
      mapboxRef.current = mapboxgl;
      map = new mapboxgl.Map({
        container: mapDivRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: DEFAULT_MAP_CENTER,
        zoom: 9,
      });
      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      map.on('load', () => {
        // The highlighted route: a white casing under a brass line.
        map.addSource('route', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'route-casing', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': 0.95 },
        });
        map.addLayer({
          id: 'route-line', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': BRASS, 'line-width': 6 },
        });
        map.addSource('route-straight', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'route-straight-line', type: 'line', source: 'route-straight',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': BRASS, 'line-width': 4, 'line-opacity': 0.6, 'line-dasharray': [2, 2] },
        });
        mapRef.current = map;
        setMapReady(true);
      });
      ro = new ResizeObserver(() => map.resize());
      ro.observe(mapDivRef.current);
    })();
    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      if (map) map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [phase]);

  // Line, pins and framing.
  const framedKeyRef = useRef('');
  useEffect(() => {
    if (!mapReady) return undefined;
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    const roadMatches = !!road && road.key === pointsKey;
    map.getSource('route')?.setData(roadMatches ? { type: 'Feature', geometry: road.geometry, properties: {} } : EMPTY);
    map.getSource('route-straight')?.setData(
      !roadMatches && points.length >= 2
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) }, properties: {} }
        : EMPTY
    );

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (start) {
      markersRef.current.push(
        new mapboxgl.Marker({ element: pinElement('S', 'start', route?.start_label || 'Start') })
          .setLngLat([start.lng, start.lat]).addTo(map)
      );
    }
    let shown = 0;
    stops.forEach((s, i) => {
      if (s.skipped_at) return;
      shown += 1;
      if (!stopHasCoords(s)) return;
      const el = pinElement(s.visited_at ? '✓' : String(shown), s.visited_at ? 'visited' : 'stop', `${shown}. ${s.property_name}`);
      el.addEventListener('click', () => setSelectedIndex(i));
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([Number(s.property_lng), Number(s.property_lat)]).addTo(map));
    });

    if (framedKeyRef.current !== pointsKey && points.length > 0) {
      framedKeyRef.current = pointsKey;
      if (points.length === 1) {
        map.easeTo({ center: [points[0].lng, points[0].lat], zoom: 14, duration: 0 });
      } else {
        const b = new mapboxgl.LngLatBounds();
        points.forEach(p => b.extend([p.lng, p.lat]));
        // Leave room on the left for the floating stops pane on wide screens.
        const wide = typeof window !== 'undefined' && window.innerWidth > 900;
        map.fitBounds(b, { padding: { top: 60, bottom: 60, right: 60, left: wide ? 400 : 60 }, maxZoom: 14, duration: 0 });
      }
    }
    return undefined;
  }, [mapReady, road, pointsKey, stops, start, points, route]);

  // Selecting a stop from the pane or a pin: fly to it and show its card.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (selectedIndex == null) return;
    const s = stops[selectedIndex];
    if (!s || !stopHasCoords(s)) return;
    const center = [Number(s.property_lng), Number(s.property_lat)];
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 14), duration: 500 });
    const el = document.createElement('div');
    const name = document.createElement('div');
    name.style.cssText = 'font-weight:700;font-size:12.5px;color:#171714';
    name.textContent = s.property_name || 'Stop';
    const addr = document.createElement('div');
    addr.style.cssText = 'font-size:11.5px;color:#4a4a45;margin-top:2px';
    addr.textContent = formatStopAddress(s) || 'No address';
    el.appendChild(name);
    el.appendChild(addr);
    popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 16, maxWidth: '260px' })
      .setLngLat(center).setDOMContent(el).addTo(map);
  }, [selectedIndex, mapReady, stops]);

  async function startDriving() {
    if (!route) return;
    setStarting(true);
    setError('');
    try {
      if (route.status === 'saved') await activateSavedRoute(route);
      router.push('/sales/routes?drive=1');
    } catch (err) {
      setError(err.message || 'Could not start this route.');
      setStarting(false);
    }
  }

  function openInGoogleMaps() {
    const parts = [
      ...(route?.start_label ? [route.start_label] : []),
      ...routed.map(s => formatStopAddress(s)).filter(Boolean),
    ];
    if (parts.length === 0) return;
    window.open(`https://www.google.com/maps/dir/${parts.map(a => encodeURIComponent(a)).join('/')}`, '_blank');
  }

  if (loading || !session) return null;

  const live = stops.filter(s => !s.skipped_at);
  const skippedCount = stops.length - live.length;
  const visitedCount = live.filter(s => s.visited_at).length;
  const pendingCount = live.length - visitedCount;
  const isOpenRoute = route && (route.status === 'saved' || route.status === 'active');
  const haveDrive = !!legs;
  const miles = road && road.meters != null ? formatMiles(metersToMiles(road.meters)) : (route?.est_meters != null ? formatMiles(metersToMiles(Number(route.est_meters))) : null);
  const statusLabel = { active: 'In progress', saved: 'Saved', completed: 'Completed', canceled: 'Canceled' }[route?.status] || '';

  return (
    <AppShell>
      <div className="container">
        <style>{`
          .ro-stage { position: relative; height: calc(100vh - 150px); min-height: 520px; }
          .ro-map { position: absolute; inset: 0; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; background: #e8e4da; }
          .ro-pane { position: absolute; z-index: 3; top: 10px; left: 10px; bottom: 10px; width: 350px; background: var(--card-bg, #fff); border: 1px solid var(--panel-line, var(--line)); border-radius: 10px; box-shadow: 0 6px 22px rgba(0,0,0,0.35); display: flex; flex-direction: column; min-height: 0; }
          .ro-pane.ro-min { bottom: auto; }
          .ro-stops { flex: 1; min-height: 0; overflow-y: auto; padding: 0 14px 8px; scrollbar-width: thin; }
          @media (max-width: 900px) {
            .ro-stage { height: auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
            .ro-map { position: relative; inset: auto; height: 420px; order: 1; }
            .ro-pane { position: static; width: auto; order: 2; }
            .ro-stops { max-height: none; overflow: visible; }
          }
        `}</style>

        {phase === 'loading' && <div className="card">Loading route…</div>}
        {phase === 'missing' && (
          <div className="card">
            <h3>Route not found</h3>
            <div style={{ fontSize: 13, marginBottom: 12 }}>{error || 'This route was deleted or is not yours to open.'}</div>
            <Link href="/dashboard" className="btn btn-sm">Back to Dashboard</Link>
          </div>
        )}

        {phase === 'ready' && route && (
          <div className="ro-stage">
            <div className="ro-map">
              {!TOKEN ? (
                <div style={{ padding: 24, fontSize: 13, color: 'var(--ink-soft)' }}>
                  The map needs a Mapbox public token. Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in Vercel (Project Settings, Environment Variables), then redeploy.
                </div>
              ) : (
                <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
              )}
            </div>

            <div className={`ro-pane${paneMin ? ' ro-min' : ''}`}>
              <div style={{ padding: '12px 14px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Link href="/dashboard" style={{ fontSize: 12, color: 'var(--ink-soft)', textDecoration: 'none' }}>← Dashboard</Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${route.status === 'completed' ? 'badge-approved' : route.status === 'saved' ? 'badge-scheduled' : ''}`}>{statusLabel}</span>
                    <button type="button" style={minBtnStyle} aria-expanded={!paneMin} aria-label={paneMin ? 'Expand stops' : 'Minimize stops'} onClick={() => setPaneMin(v => !v)}>{paneMin ? '+' : '−'}</button>
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                  {live.length} stop{live.length === 1 ? '' : 's'}
                  {route.status === 'active' ? `, ${visitedCount} visited` : ''}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
                  {roadBusy && <span style={{ color: 'var(--ink-soft)' }}>Loading route…</span>}
                  {!roadBusy && (
                    <>
                      {miles && <strong>{miles} mi</strong>}
                      {haveDrive && ` · ${formatDuration(road.seconds)} drive`}
                      {pendingCount > 0 && ` · ${formatMinutes(timeline.dwellMinutes)} at stops`}
                      {haveDrive && pendingCount > 0 && ` · ${formatMinutes(timeline.totalMinutes)} total`}
                    </>
                  )}
                  {!roadBusy && timeline.finishAt && pendingCount > 0 && (
                    <div style={{ color: 'var(--ink-soft)' }}>
                      {route.status === 'saved' && route.depart_time ? `Leave at ${formatClock(timeStringToToday(String(route.depart_time).slice(0, 5)))}, ` : ''}
                      done around {formatClock(timeline.finishAt)}
                    </div>
                  )}
                  {roadError && <div style={{ color: '#a17c3f', fontSize: 11.5 }}>{roadError}</div>}
                  {skippedCount > 0 && <div style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>{skippedCount} skipped on this route</div>}
                </div>
                {!paneMin && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {isOpenRoute && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={starting} onClick={startDriving}>
                        {starting ? 'Starting…' : route.status === 'active' ? 'Resume Driving →' : 'Start Driving →'}
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={openInGoogleMaps} disabled={routed.length === 0}>Open in Google Maps</button>
                  </div>
                )}
                {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
              </div>

              {!paneMin && (
                <div className="ro-stops">
                  {start && (
                    <div style={rowStyle}>
                      <span style={{ ...badgeStyle, background: '#16a34a' }}>S</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{route.start_label || 'Start'}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Start</div>
                      </div>
                    </div>
                  )}
                  {stops.map((s, i) => {
                    const row = timeline.rows[i];
                    const leg = legByStop[i];
                    const skipped = !!s.skipped_at && !s.visited_at;
                    const position = stops.slice(0, i + 1).filter(x => !x.skipped_at).length;
                    const selected = selectedIndex === i;
                    const meta = [
                      leg && leg.seconds != null && !skipped ? `${formatDuration(leg.seconds)} drive` : null,
                      !skipped && !s.visited_at && row ? `${formatMinutes(row.dwellMinutes)} at stop` : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <div
                        key={s.property_id ? `${s.property_id}-${i}` : i}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedIndex(selected ? null : i)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedIndex(selected ? null : i); }}
                        style={{ ...rowStyle, cursor: 'pointer', background: selected ? 'rgba(155,119,61,0.10)' : 'transparent' }}
                      >
                        <span style={{ ...badgeStyle, background: skipped ? '#8a8a84' : s.visited_at ? '#5a7d5a' : INK }}>
                          {skipped ? 'x' : s.visited_at ? '✓' : position}
                        </span>
                        <div style={{ minWidth: 0, flex: 1, opacity: skipped || s.visited_at ? 0.65 : 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, textDecoration: skipped ? 'line-through' : 'none' }}>{s.property_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                            {skipped ? 'Skipped on this route' : (formatStopAddress(s) || 'No address, not shown on the map')}
                          </div>
                          {!skipped && meta && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{meta}</div>}
                        </div>
                        {!skipped && !s.visited_at && row && row.arrive && (
                          <div style={{ fontSize: 11.5, fontWeight: 700, flexShrink: 0, textAlign: 'right' }}>{formatClock(row.arrive)}</div>
                        )}
                        {s.visited_at && (
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)', flexShrink: 0 }}>{formatClock(new Date(s.visited_at))}</div>
                        )}
                      </div>
                    );
                  })}
                  {stops.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '10px 0' }}>No stops on this route.</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

const rowStyle = { display: 'flex', gap: 10, alignItems: 'center', padding: '9px 6px', borderTop: '1px solid var(--line)', borderRadius: 4 };
const badgeStyle = {
  flex: 'none', width: 26, height: 26, borderRadius: '50%', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
};
const minBtnStyle = {
  border: '1px solid var(--line)', background: 'transparent', color: 'inherit', borderRadius: 6,
  width: 26, height: 26, lineHeight: 1, cursor: 'pointer', fontSize: 15, fontWeight: 700, flexShrink: 0,
};
