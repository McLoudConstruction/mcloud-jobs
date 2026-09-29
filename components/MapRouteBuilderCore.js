'use client';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import MapboxPlaceSearch from './MapboxPlaceSearch';
import DriveModeOverlay from './DriveModeOverlay';
import { findOrCreatePropertyForRouteStop } from '../lib/contactSync';
import { useDragReorder } from '../lib/useDragReorder';
import {
  getActiveRoute, startRoute, updateRouteStops, finishRoute, cancelRoute,
  getCurrentLocation, haversineMiles,
} from '../lib/salesRoutes';
import { orderStops, cheapestInsertionIndex, pointsKey } from '../lib/routeOrdering';
import {
  MAPBOX_MAX_POINTS, VISIT_BUCKETS, visitBucket, daysSince,
  reverseGeocode, searchPlaces, fetchDirections, geocodeAddressPermanent,
} from '../lib/mapboxRoute';
import {
  DEFAULT_MAP_CENTER, buildStop, stopHasCoords, formatStopAddress,
  metersToMiles, formatMiles, formatDuration, straightLineMiles,
} from '../lib/mapRouteHelpers';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const PROPERTY_FIELDS = 'id, property_name, property_type, management_company, property_street, property_city, property_state, property_zip, property_lat, property_lng, prospect_stage, last_visited_at';
const PAGE_SIZE = 1000;
const IN_VIEW_LIMIT = 100;
const ROUTE_DEBOUNCE_MS = 500;
const DUPLICATE_RADIUS_MILES = 0.02; // ~30 m, a second tap on the same building
const INK = '#1C1B19';
const RUST = '#A8471F';
const EMPTY = { type: 'FeatureCollection', features: [] };

function stripKey({ key, ...rest }) {
  return rest;
}

function stopLngLat(s) {
  return [Number(s.property_lng), Number(s.property_lat)];
}

function stopPoint(s) {
  return { lat: Number(s.property_lat), lng: Number(s.property_lng) };
}

function hasCoords(p) {
  return p.property_lat != null && p.property_lng != null;
}

function sameStop(a, b) {
  if (a.property_id && b.property_id && a.property_id === b.property_id) return true;
  const sa = (a.property_street || '').trim().toLowerCase();
  const sb = (b.property_street || '').trim().toLowerCase();
  if (sa && sb && sa === sb && (a.property_zip || '') === (b.property_zip || '')) return true;
  if (stopHasCoords(a) && stopHasCoords(b)) {
    const d = haversineMiles(stopPoint(a), stopPoint(b));
    if (d != null && d < DUPLICATE_RADIUS_MILES) return true;
  }
  // Two hand-typed stops with no address to compare: same name is the same stop.
  if (!sa && !sb && !stopHasCoords(a) && !stopHasCoords(b)) {
    const na = (a.property_name || '').trim().toLowerCase();
    const nb = (b.property_name || '').trim().toLowerCase();
    if (na && na === nb) return true;
  }
  return false;
}

function pinElement(label, kind, title) {
  const el = document.createElement('div');
  el.textContent = label;
  if (title) el.title = title;
  const bg = kind === 'start' ? '#16a34a' : kind === 'visited' ? '#5a7d5a' : INK;
  el.style.cssText = [
    'width:26px', 'height:26px', 'border-radius:50%', 'box-sizing:border-box',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:700 12px/1 system-ui,sans-serif', 'color:#fff', `background:${bg}`,
    'border:2px solid #fff', 'box-shadow:0 2px 6px rgba(0,0,0,0.4)', 'cursor:pointer',
  ].join(';');
  return el;
}

// Map-first Sales Route builder on Mapbox, modeled on the Overlanding Trip
// Planner's trip screen. Every property with a location shows as a point,
// colored by how recently it was visited; hover for its name and management
// company, tap to select it and add it to the route. A "saved properties in
// view" list follows the map, and the route line, mileage and per-leg times
// redraw as the stop list changes.
//
// Stops are ordered automatically for the most efficient drive (exact up to
// 12 stops, heuristic beyond) until you reorder by hand; "Re-optimize order"
// hands control back. New stops slot in where they add the least driving.
//
// Saves into the same sales_routes flow as the typed builder, so Drive Mode,
// resume-after-screen-off and Recent Routes work unchanged.
export default function MapRouteBuilderCore({ onClose, onRouteChanged, hideChrome }) {
  const [staffId, setStaffId] = useState(null);
  const [checkingActive, setCheckingActive] = useState(true);
  const [route, setRoute] = useState(null); // saved sales_routes row once started/resumed
  const [stops, setStops] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [startPoint, setStartPoint] = useState(null); // { lat, lng }
  const [autoOrder, setAutoOrder] = useState(true);
  const [followRoads, setFollowRoads] = useState(true);
  const [showSaved, setShowSaved] = useState(true);
  const [allProps, setAllProps] = useState([]);
  const [propsLoaded, setPropsLoaded] = useState(false);
  const [propsError, setPropsError] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [homeBusy, setHomeBusy] = useState(false);
  const [selected, setSelected] = useState(null); // { type: 'saved', id } | { type: 'spot', stop }
  const [bounds, setBounds] = useState(null);
  const [roadRoute, setRoadRoute] = useState(null); // { key, geometry, meters, seconds, legs }
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [driving, setDriving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [confirmLocate, setConfirmLocate] = useState(false);
  const [locating, setLocating] = useState(null); // { done, total }

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const mapboxRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const spotMarkerRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const framedRef = useRef(false);
  const fitAfterRouteRef = useRef(true);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const startRef = useRef(startPoint);
  startRef.current = startPoint;
  const roadRouteRef = useRef(roadRoute);
  roadRouteRef.current = roadRoute;

  const isActive = !!route;

  // ── Load staff + resume any active route ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data?.user?.id || null;
      if (cancelled) return;
      setStaffId(id);
      if (id) {
        supabase.from('staff_users').select('home_address').eq('id', id).maybeSingle()
          .then(({ data: h }) => { if (!cancelled && h?.home_address) setHomeAddress(h.home_address); });
        const active = await getActiveRoute(id);
        if (!cancelled && active && (active.stops || []).length > 0) {
          setRoute(active);
          setStops(active.stops);
          setAutoOrder(false); // never reshuffle a route already in progress
          if (active.start_lat != null && active.start_lng != null) {
            setStartPoint({ lat: Number(active.start_lat), lng: Number(active.start_lng) });
            setStartInput(active.start_label || 'Your current location');
          }
        }
      }
      if (!cancelled) setCheckingActive(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Every property (the whole Property Database), fetched in pages ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = [];
      let fields = PROPERTY_FIELDS;
      let failure = '';
      for (let from = 0; ; from += PAGE_SIZE) {
        let res = await supabase.from('properties').select(fields).order('id').range(from, from + PAGE_SIZE - 1);
        if (res.error && fields !== '*') {
          // A named column may be missing on this database; take everything instead.
          fields = '*';
          res = await supabase.from('properties').select(fields).order('id').range(from, from + PAGE_SIZE - 1);
        }
        if (res.error) { failure = res.error.message || 'Unknown error'; break; }
        const data = res.data || [];
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      if (!cancelled && failure) setPropsError(failure);
      if (!cancelled) { setAllProps(rows); setPropsLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const savedProps = useMemo(() => allProps.filter(hasCoords), [allProps]);
  const unlocated = useMemo(() => allProps.filter(p => !hasCoords(p) && p.property_street), [allProps]);
  const bucketCounts = useMemo(() => {
    const counts = [0, 0, 0, 0];
    savedProps.forEach(p => { counts[visitBucket(p.last_visited_at)] += 1; });
    return counts;
  }, [savedProps]);

  // ── Create the map once the container is on screen ────────────────────
  useEffect(() => {
    if (checkingActive || !TOKEN) return undefined;
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
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      const emitBounds = () => {
        const b = map.getBounds();
        if (!b) return;
        setBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      };

      map.on('load', () => {
        // Road route: white casing under a dark line.
        map.addSource('route', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'route-casing', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
        });
        map.addLayer({
          id: 'route-line', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': INK, 'line-width': 4 },
        });
        // Straight segments shown while the road route is pending or unavailable.
        map.addSource('route-straight', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'route-straight-line', type: 'line', source: 'route-straight',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': INK, 'line-width': 3, 'line-opacity': 0.45, 'line-dasharray': [2, 2] },
        });
        // Every property, colored by last visit.
        map.addSource('props', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'props-circles', type: 'circle', source: 'props',
          filter: ['!=', ['get', 'inRoute'], 1],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 9, 5, 13, 8],
            'circle-color': [
              'match', ['get', 'bucket'],
              0, VISIT_BUCKETS[0].color,
              1, VISIT_BUCKETS[1].color,
              2, VISIT_BUCKETS[2].color,
              VISIT_BUCKETS[3].color,
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        });
        map.addLayer({
          id: 'props-selected', type: 'circle', source: 'props', filter: ['==', ['get', 'id'], ''],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 10, 13, 13],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': INK,
            'circle-stroke-width': 3,
          },
        });

        // Hover card: property name and management company.
        const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'mrb-popup', maxWidth: '260px' });
        map.on('mousemove', 'props-circles', e => {
          const f = e.features && e.features[0];
          if (!f) return;
          map.getCanvas().style.cursor = 'pointer';
          const el = document.createElement('div');
          const name = document.createElement('div');
          name.style.cssText = 'font-weight:700;font-size:12.5px';
          name.textContent = f.properties.name || 'Unnamed property';
          const mgmt = document.createElement('div');
          mgmt.style.cssText = 'font-size:11.5px;color:#666;margin-top:2px';
          mgmt.textContent = f.properties.mgmt || 'No management company';
          el.appendChild(name);
          el.appendChild(mgmt);
          popup.setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);
        });
        map.on('mouseleave', 'props-circles', () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });

        // One click handler: a property circle selects that property, anything
        // else is treated as "tell me what's here".
        map.on('click', e => {
          const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
          const hits = map.queryRenderedFeatures(box, { layers: ['props-circles'] });
          if (hits.length) {
            setNotice('');
            setSelected({ type: 'saved', id: String(hits[0].properties.id) });
            return;
          }
          if (clickHandlerRef.current) clickHandlerRef.current(e);
        });

        mapRef.current = map;
        emitBounds();
        setMapReady(true);
      });
      map.on('moveend', emitBounds);

      ro = new ResizeObserver(() => map.resize());
      ro.observe(mapDivRef.current);
    })();
    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      stopMarkersRef.current.forEach(m => m.remove());
      stopMarkersRef.current = [];
      if (spotMarkerRef.current) { spotMarkerRef.current.remove(); spotMarkerRef.current = null; }
      if (map) map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [checkingActive]);

  const fitToStops = useCallback(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl) return;
    const pts = [
      ...(startRef.current ? [[startRef.current.lng, startRef.current.lat]] : []),
      ...stopsRef.current.filter(stopHasCoords).map(stopLngLat),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) { map.easeTo({ center: pts[0], zoom: 15, duration: 500 }); return; }
    const b = new mapboxgl.LngLatBounds();
    pts.forEach(p => b.extend(p));
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 600 });
  }, []);

  // Frame a resumed route once, as soon as both the map and stops exist.
  useEffect(() => {
    if (mapReady && !framedRef.current && stops.length > 0) {
      framedRef.current = true;
      fitToStops();
    }
  }, [mapReady, stops, fitToStops]);

  // ── Property points ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const onRoute = new Set(stops.map(s => s.property_id).filter(Boolean));
    mapRef.current.getSource('props')?.setData({
      type: 'FeatureCollection',
      features: savedProps.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(p.property_lng), Number(p.property_lat)] },
        properties: {
          id: p.id,
          name: p.property_name || '',
          mgmt: p.management_company || '',
          bucket: visitBucket(p.last_visited_at),
          inRoute: onRoute.has(p.id) ? 1 : 0,
        },
      })),
    });
  }, [mapReady, savedProps, stops]);

  useEffect(() => {
    if (!mapReady) return;
    const selId = selected?.type === 'saved' ? selected.id : '';
    mapRef.current.setFilter('props-selected', ['==', ['get', 'id'], selId]);
  }, [mapReady, selected]);

  useEffect(() => {
    if (!mapReady) return;
    const vis = showSaved ? 'visible' : 'none';
    ['props-circles', 'props-selected'].forEach(id => mapRef.current.setLayoutProperty(id, 'visibility', vis));
  }, [mapReady, showSaved]);

  // ── Persisting and resolving stops ────────────────────────────────────
  // Nothing new is written to the Property Database until "Save & Start
  // Route", so exploring the map and discarding a draft leaves no stray
  // properties. Once a route is active, each added stop is resolved right
  // away since it is persisted immediately.
  const persistStops = useCallback(async (next) => {
    setStops(next);
    if (route?.id) {
      try { await updateRouteStops(route.id, next.map(stripKey)); } catch (err) { setError(err.message); }
    }
  }, [route]);

  const resolveStop = useCallback(async (stop) => {
    if (stop.property_id) return { stop, reused: false };
    const { property, created } = await findOrCreatePropertyForRouteStop({
      name: stop.property_name, street: stop.property_street, city: stop.property_city,
      state: stop.property_state, zip: stop.property_zip, lat: stop.property_lat, lng: stop.property_lng,
    });
    if (!property) throw new Error(`Could not save ${stop.property_name || 'that stop'} as a property.`);
    const resolved = buildStop({ property });
    return { stop: { ...resolved, key: stop.key }, reused: !created };
  }, []);

  // ── Ordering ─────────────────────────────────────────────────────────
  // Visited stops stay first as history; only what is left gets ordered,
  // leaving from the last visited stop (or the start, if set).
  function anchorFor(list, startOverride) {
    const lastVisited = [...list].reverse().find(s => s.visited_at && stopHasCoords(s));
    if (lastVisited) return stopPoint(lastVisited);
    const start = startOverride !== undefined ? startOverride : startRef.current;
    return start || null;
  }

  function arrange(list, startOverride) {
    const visited = list.filter(s => s.visited_at);
    const todo = list.filter(s => !s.visited_at);
    return [...visited, ...orderStops(anchorFor(list, startOverride), todo)];
  }

  const addStop = useCallback(async (stop, fromMap) => {
    setError('');
    setNotice('');
    const current = stopsRef.current;
    if (current.some(s => sameStop(s, stop))) {
      setNotice(`${stop.property_name || 'That spot'} is already on this route.`);
      return;
    }
    const hasStart = !!startRef.current;
    if (current.length + (hasStart ? 1 : 0) >= MAPBOX_MAX_POINTS) {
      setNotice(`A route can have at most ${MAPBOX_MAX_POINTS - (hasStart ? 1 : 0)} stops${hasStart ? ' with a starting location' : ''}.`);
      return;
    }
    try {
      let toAdd = stop;
      if (route?.id) {
        const { stop: resolved, reused } = await resolveStop(stop);
        toAdd = resolved;
        if (reused) setNotice(`${resolved.property_name} was already in your Property Database, reused it.`);
      }
      const latest = stopsRef.current;
      const visited = latest.filter(s => s.visited_at);
      const todo = latest.filter(s => !s.visited_at);
      const anchor = anchorFor(latest);
      let nextTodo;
      if (autoOrder) {
        nextTodo = orderStops(anchor, [...todo, toAdd]);
      } else {
        const idx = cheapestInsertionIndex(anchor, todo, toAdd);
        nextTodo = [...todo.slice(0, idx), toAdd, ...todo.slice(idx)];
      }
      fitAfterRouteRef.current = !fromMap; // don't move the map while picking from it
      await persistStops([...visited, ...nextTodo]);
    } catch (err) {
      setError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, autoOrder, persistStops, resolveStop]);

  // Tapping a business label or an empty spot selects it (address looked up)
  // and opens its card; nothing is added until you say so.
  clickHandlerRef.current = async (e) => {
    if (driving) return;
    const map = mapRef.current;
    const poi = map.queryRenderedFeatures(e.point).find(f => /poi/i.test(f.layer?.id || '') && f.properties?.name);
    const lngLat = poi && poi.geometry?.type === 'Point' ? poi.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
    setBusy('Finding address…');
    setError('');
    setNotice('');
    try {
      const found = await reverseGeocode(lngLat[0], lngLat[1], TOKEN);
      if (!found) {
        setNotice('No street address found there. Tap a building, a business label, or a spot on a road.');
        return;
      }
      setSelected({
        type: 'spot',
        stop: buildStop({
          name: poi ? poi.properties.name : found.name,
          street: found.street, city: found.city, state: found.state, zip: found.zip,
          lat: poi ? lngLat[1] : found.lat, lng: poi ? lngLat[0] : found.lng,
        }),
      });
    } catch {
      setNotice('Could not look up an address for that spot.');
    } finally {
      setBusy('');
    }
  };

  // A place typed in by hand. If it matches a property already in the database
  // by name, use that property (and its address); otherwise it goes on the route
  // by name alone. Name-only stops can't be drawn or ordered by distance, so they
  // sit at the end of the list until they resolve to a real property.
  function addTypedStop(text) {
    const wanted = text.trim().toLowerCase();
    const match = allProps.find(p => (p.property_name || '').trim().toLowerCase() === wanted);
    if (match) {
      if (hasCoords(match) && mapRef.current) {
        mapRef.current.easeTo({ center: [Number(match.property_lng), Number(match.property_lat)], zoom: 15, duration: 500 });
      }
      addStop(buildStop({ property: match }), false);
      return;
    }
    addStop(buildStop({ name: text.trim() }), false);
    setNotice(`Added ${text.trim()} by name. It has no map location, so it is not drawn on the map or ordered by distance.`);
  }

  function handleSearchPicked(place) {
    const map = mapRef.current;
    if (map) map.easeTo({ center: [place.lng, place.lat], zoom: 16, duration: 500 });
    if (!place.street) {
      setNotice('That result has no street address, so it was not added. Tap the building on the map instead.');
      return;
    }
    addStop(buildStop({
      name: place.name, street: place.street, city: place.city, state: place.state,
      zip: place.zip, lat: place.lat, lng: place.lng,
    }), false);
  }

  // Saved properties matching what's typed, offered ahead of Mapbox's own suggestions.
  const localMatches = useCallback((q) => savedProps
    .filter(p => `${p.property_name} ${p.property_street || ''} ${p.property_city || ''}`.toLowerCase().includes(q))
    .slice(0, 4)
    .map(p => ({
      key: `s-${p.id}`,
      label: `⌂ ${p.property_name}`,
      sub: `Saved property${p.property_city ? ` · ${p.property_city}` : ''}`,
      pick: () => {
        const map = mapRef.current;
        setSelected({ type: 'saved', id: p.id });
        if (map) map.easeTo({ center: [Number(p.property_lng), Number(p.property_lat)], zoom: 15, duration: 500 });
        addStop(buildStop({ property: p }), false);
      },
    })), [savedProps, addStop]);

  // ── Start location (draft only; a saved route keeps the start it began with) ─
  function chooseStart(label, point) {
    setStartInput(label);
    setStartPoint(point);
    fitAfterRouteRef.current = true;
    if (autoOrder && stopsRef.current.length > 1) persistStops(arrange(stopsRef.current, point));
  }

  async function useMyLocation() {
    setError('');
    const loc = await getCurrentLocation();
    if (!loc) { setError('Could not get your current location. Enable location access and try again.'); return; }
    chooseStart('Your current location', loc);
  }

  async function useHome() {
    setError('');
    if (!homeAddress) return;
    setHomeBusy(true);
    const found = await searchPlaces(homeAddress, TOKEN, null, 'address,poi');
    setHomeBusy(false);
    const hit = found[0];
    if (!hit) { setError('Could not find your home address on the map. Check it in Settings.'); return; }
    chooseStart(homeAddress, { lat: hit.lat, lng: hit.lng });
  }

  function clearStart() {
    setStartInput('');
    setStartPoint(null);
  }

  // ── Route order interactions ──────────────────────────────────────────
  function manualReorder(list) {
    if (autoOrder) setAutoOrder(false); // the person's manual order wins
    fitAfterRouteRef.current = false;
    persistStops(list);
  }

  function moveStop(from, to) {
    if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) return;
    const next = [...stops];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    manualReorder(next);
  }

  const stopsDrag = useDragReorder(stops, manualReorder);

  function removeStop(index) {
    fitAfterRouteRef.current = false;
    persistStops(stops.filter((_, i) => i !== index));
  }

  function reoptimize() {
    setAutoOrder(true);
    fitAfterRouteRef.current = true;
    persistStops(arrange(stops));
  }

  function toggleAuto(on) {
    if (on) reoptimize();
    else setAutoOrder(false);
  }

  function focusStop(index) {
    const s = stops[index];
    const map = mapRef.current;
    if (map && s && stopHasCoords(s)) map.easeTo({ center: stopLngLat(s), zoom: Math.max(map.getZoom(), 15), duration: 500 });
  }

  // ── Derived: route points, drawn route, totals ────────────────────────
  const routePoints = useMemo(
    () => [...(startPoint ? [startPoint] : []), ...stops.filter(stopHasCoords).map(stopPoint)],
    [startPoint, stops]
  );
  const routeKey = useMemo(() => pointsKey(routePoints), [routePoints]);
  const roadInSync = !!roadRoute && roadRoute.key === routeKey;
  const allPlaced = stops.every(stopHasCoords);

  // Keep the road route in sync with the ordered stops (debounced; a newer
  // edit supersedes an older request).
  useEffect(() => {
    if (!mapReady) return undefined;
    if (!followRoads || routePoints.length < 2) {
      setRouteBusy(false);
      setRouteError('');
      return undefined;
    }
    if (roadRouteRef.current && roadRouteRef.current.key === routeKey) {
      setRouteBusy(false);
      return undefined;
    }
    const ctrl = new AbortController();
    setRouteBusy(true);
    const timer = setTimeout(async () => {
      const { route: r, error: err } = await fetchDirections(routePoints, TOKEN, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setRouteBusy(false);
      if (err) { setRouteError(err); return; }
      setRouteError('');
      setRoadRoute({ key: routeKey, ...r });
      if (fitAfterRouteRef.current) fitToStops();
    }, ROUTE_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, followRoads, mapReady]);

  // Draw the route: white-cased road line once it matches the current stops,
  // dashed straight segments while it is pending or unavailable.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const showRoad = roadInSync && followRoads;
    map.getSource('route')?.setData(
      showRoad ? { type: 'Feature', geometry: roadRoute.geometry, properties: {} } : EMPTY
    );
    map.getSource('route-straight')?.setData(
      !showRoad && routePoints.length >= 2
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: routePoints.map(p => [p.lng, p.lat]) }, properties: {} }
        : EMPTY
    );
  }, [mapReady, roadInSync, roadRoute, routePoints, followRoads]);

  const totals = useMemo(() => {
    if (routePoints.length < 2) return null;
    if (roadInSync && followRoads && roadRoute.meters != null) {
      return { miles: metersToMiles(roadRoute.meters), seconds: roadRoute.seconds, approx: false };
    }
    return { miles: straightLineMiles(routePoints), seconds: null, approx: true };
  }, [routePoints, roadInSync, roadRoute, followRoads]);

  const legs = roadInSync && followRoads && allPlaced && roadRoute.legs.length === routePoints.length - 1 ? roadRoute.legs : null;

  // ── Pins ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return undefined;
    const mapboxgl = mapboxRef.current;
    const map = mapRef.current;
    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];
    if (startPoint) {
      stopMarkersRef.current.push(
        new mapboxgl.Marker({ element: pinElement('S', 'start', startInput || 'Start') })
          .setLngLat([startPoint.lng, startPoint.lat]).addTo(map)
      );
    }
    stops.forEach((s, i) => {
      if (!stopHasCoords(s)) return;
      stopMarkersRef.current.push(
        new mapboxgl.Marker({ element: pinElement(s.visited_at ? '✓' : String(i + 1), s.visited_at ? 'visited' : 'stop', `${i + 1}. ${s.property_name}`) })
          .setLngLat(stopLngLat(s)).addTo(map)
      );
    });
    return () => {
      stopMarkersRef.current.forEach(m => m.remove());
      stopMarkersRef.current = [];
    };
  }, [stops, startPoint, startInput, mapReady]);

  // Marker for a tapped building or spot that isn't added yet.
  useEffect(() => {
    if (!mapReady) return undefined;
    const mapboxgl = mapboxRef.current;
    if (spotMarkerRef.current) { spotMarkerRef.current.remove(); spotMarkerRef.current = null; }
    if (selected?.type !== 'spot' || !stopHasCoords(selected.stop)) return undefined;
    spotMarkerRef.current = new mapboxgl.Marker({ color: RUST })
      .setLngLat(stopLngLat(selected.stop)).addTo(mapRef.current);
    return () => {
      if (spotMarkerRef.current) { spotMarkerRef.current.remove(); spotMarkerRef.current = null; }
    };
  }, [selected, mapReady]);

  // ── Properties in the current map view ───────────────────────────────
  const inView = useMemo(() => {
    if (!bounds) return [];
    const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
    return savedProps
      .filter(p => Number(p.property_lat) >= bounds.south && Number(p.property_lat) <= bounds.north
        && Number(p.property_lng) >= bounds.west && Number(p.property_lng) <= bounds.east)
      .map(p => ({ p, d: haversineMiles(center, { lat: Number(p.property_lat), lng: Number(p.property_lng) }) ?? Infinity }))
      .sort((a, b) => a.d - b.d)
      .map(x => x.p);
  }, [savedProps, bounds]);

  const selectedSaved = selected?.type === 'saved' ? savedProps.find(p => p.id === selected.id) || null : null;
  const detailStop = selectedSaved ? buildStop({ property: selectedSaved }) : (selected?.type === 'spot' ? selected.stop : null);
  const detailIndex = detailStop ? stops.findIndex(s => sameStop(s, detailStop)) : -1;

  function stopIndexForProperty(p) {
    return stops.findIndex(s => s.property_id === p.id);
  }

  function pickSaved(p) {
    setSelected({ type: 'saved', id: p.id });
    const map = mapRef.current;
    if (map) map.easeTo({ center: [Number(p.property_lng), Number(p.property_lat)], zoom: Math.max(map.getZoom(), 13), duration: 500 });
  }

  function addDetail() {
    if (!detailStop) return;
    addStop(detailStop, true);
    if (selected?.type === 'spot') setSelected(null);
  }

  function removeDetail() {
    if (detailIndex >= 0) removeStop(detailIndex);
  }

  function useDetailAsStart() {
    if (!detailStop || !stopHasCoords(detailStop)) return;
    chooseStart(detailStop.property_name, stopPoint(detailStop));
  }

  // ── One-time backfill: give address-only properties a map location ────
  async function locateMissing() {
    setConfirmLocate(false);
    setError('');
    setNotice('');
    const list = unlocated.slice();
    let idx = 0;
    let done = 0;
    let located = 0;
    let stopAll = false;
    setLocating({ done: 0, total: list.length });
    async function worker() {
      while (!stopAll) {
        const i = idx++;
        if (i >= list.length) return;
        const p = list[i];
        try {
          const c = await geocodeAddressPermanent(p, TOKEN);
          if (c) {
            const { error: upErr } = await supabase.from('properties')
              .update({ property_lat: c.lat, property_lng: c.lng }).eq('id', p.id);
            if (upErr) throw upErr;
            located += 1;
            setAllProps(prev => prev.map(x => (x.id === p.id ? { ...x, property_lat: c.lat, property_lng: c.lng } : x)));
          }
        } catch (err) {
          if (err.status === 401 || err.status === 403) {
            stopAll = true;
            setError('Mapbox refused the permanent geocoding request. Permanent geocoding has to be enabled on your Mapbox account before addresses can be saved as map locations.');
          }
        }
        done += 1;
        setLocating({ done, total: list.length });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setLocating(null);
    if (!stopAll) setNotice(`Located ${located} of ${list.length} properties. ${list.length - located > 0 ? `${list.length - located} had no address match and stay off the map.` : ''}`.trim());
  }

  // ── Route actions ────────────────────────────────────────────────────
  function openInMaps() {
    const parts = [
      ...(startPoint && startInput && startInput !== 'Your current location' ? [startInput] : []),
      ...stops.map(s => formatStopAddress(s)).filter(Boolean),
    ];
    if (parts.length === 0) return;
    window.open(`https://www.google.com/maps/dir/${parts.map(a => encodeURIComponent(a)).join('/')}`, '_blank');
  }

  async function saveAndStart() {
    if (stops.length === 0) { setError('Add at least one stop from the map or type one in.'); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const resolved = [];
      let reused = 0;
      for (const s of stops) {
        const { stop, reused: wasReused } = await resolveStop(s);
        if (wasReused) reused += 1;
        resolved.push(stripKey({ ...stop, visited_at: null }));
      }
      const saved = staffId
        ? await startRoute({
            staffId,
            startLabel: startPoint ? (startInput || 'Start') : null,
            start: startPoint,
            endLabel: null,
            end: null,
            stops: resolved,
            autoOrdered: autoOrder,
          })
        : { id: null, status: 'active', stops: resolved };
      setRoute(saved);
      setStops(saved.stops || resolved);
      if (reused > 0) setNotice(`${reused} of these ${reused === 1 ? 'was' : 'were'} already in your Property Database, reused instead of creating a duplicate.`);
      if (onRouteChanged) onRouteChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function markStopVisited(index) {
    const stop = stops[index];
    if (!stop) return;
    const nowIso = new Date().toISOString();
    if (stop.property_id) {
      await supabase.from('properties').update({ last_visited_at: nowIso }).eq('id', stop.property_id);
      setAllProps(prev => prev.map(p => (p.id === stop.property_id ? { ...p, last_visited_at: nowIso } : p)));
    }
    await persistStops(stops.map((s, i) => (i === index ? { ...s, visited_at: nowIso } : s)));
  }

  // Only un-marks this route's own record; last_visited_at on the property
  // is shared app-wide, so it is deliberately left alone (same as the typed builder).
  async function unmarkStopVisited(index) {
    if (!stops[index]) return;
    await persistStops(stops.map((s, i) => (i === index ? { ...s, visited_at: null } : s)));
  }

  async function markAllVisited() {
    if (stops.length === 0) return;
    setMarking(true);
    const nowIso = new Date().toISOString();
    const ids = stops.map(s => s.property_id).filter(Boolean);
    if (ids.length) {
      await supabase.from('properties').update({ last_visited_at: nowIso }).in('id', ids);
      const idSet = new Set(ids);
      setAllProps(prev => prev.map(p => (idSet.has(p.id) ? { ...p, last_visited_at: nowIso } : p)));
    }
    await persistStops(stops.map(s => ({ ...s, visited_at: s.visited_at || nowIso })));
    setMarking(false);
  }

  async function skipStop(index) {
    if (stops.length < 2) return;
    const stop = stops[index];
    await persistStops([...stops.filter((_, i) => i !== index), stop]);
  }

  function resetAll() {
    setRoute(null);
    setStops([]);
    setError('');
    setNotice('');
    setSelected(null);
    setRoadRoute(null);
    setStartInput('');
    setStartPoint(null);
    setAutoOrder(true);
    framedRef.current = false;
  }

  async function handleFinishRoute() {
    if (route?.id) await finishRoute(route.id);
    setDriving(false);
    resetAll();
    if (onRouteChanged) onRouteChanged();
  }

  async function discardRoute() {
    if (route?.id) await cancelRoute(route.id);
    resetAll();
    if (onRouteChanged) onRouteChanged();
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (checkingActive) {
    const loadingBody = <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>;
    return hideChrome ? loadingBody : <div className="card"><h3>Create Sales Route</h3>{loadingBody}</div>;
  }

  const remainingCount = stops.filter(s => !s.visited_at).length;

  const summary = totals && !routeBusy ? (
    <span>
      <strong>{totals.approx ? '~' : ''}{formatMiles(totals.miles)} mi</strong>
      {totals.seconds != null ? ` · ${formatDuration(totals.seconds)} drive` : ' straight-line'}
      {` · ${stops.length} stop${stops.length === 1 ? '' : 's'}`}
    </span>
  ) : routeBusy ? (
    <span style={{ color: 'var(--ink-soft)' }}>Updating route…</span>
  ) : (
    <span style={{ color: 'var(--ink-soft)' }}>
      {stops.length === 0 ? 'Add a stop from the map or type one in.' : 'Add a start or a second stop to build the route.'}
    </span>
  );

  const body = (
    <>
      <style>{`
        .mrb-grid { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
        .mrb-panel { display: flex; flex-direction: column; gap: 10px; }
        .mrb-stops { max-height: 380px; overflow-y: auto; }
        .mrb-map { position: relative; height: 580px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; background: #e8e4da; }
        .mrb-inview { max-height: 260px; overflow-y: auto; }
        .mrb-stop.over { box-shadow: 0 -3px 0 #16a34a inset; }
        .mrb-popup .mapboxgl-popup-content { padding: 7px 10px; border-radius: 7px; font-family: system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
        @media (max-width: 900px) {
          .mrb-grid { grid-template-columns: 1fr; }
          .mrb-mapcol { order: 1; }
          .mrb-panel { order: 2; }
          .mrb-map { height: 420px; }
          .mrb-stops { max-height: none; }
        }
      `}</style>

      {isActive && stops.length > 0 && (
        <div style={{ fontSize: 12, color: '#a17c3f', marginBottom: 10 }}>
          Route in progress: {remainingCount} of {stops.length} stop{stops.length === 1 ? '' : 's'} left. Tap the map to add more.
        </div>
      )}

      {TOKEN && propsLoaded && (propsError || allProps.length === 0 || unlocated.length > 0) && !locating && (
        <div style={{ fontSize: 12.5, background: 'rgba(161,124,63,0.12)', border: '1px solid rgba(161,124,63,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
          {propsError ? (
            <div>Could not load properties: {propsError}</div>
          ) : allProps.length === 0 ? (
            <div>The database returned 0 properties for this login, so there is nothing to draw.</div>
          ) : confirmLocate ? (
            <>
              <div style={{ marginBottom: 8 }}>
                This looks up each address with Mapbox permanent geocoding and saves the coordinates onto the property, one lookup per property.
                Mapbox bills those lookups and the feature has to be enabled on your account. Locate {unlocated.length} {unlocated.length === 1 ? 'property' : 'properties'}?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={locateMissing}>Yes, locate them</button>
                <button type="button" className="btn btn-sm" onClick={() => setConfirmLocate(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>
                {unlocated.length} of {allProps.length} properties have an address but no map location yet, so they are not on the map.
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmLocate(true)}>Locate them</button>
            </div>
          )}
        </div>
      )}
      {locating && (
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          Locating properties… {locating.done} of {locating.total}
        </div>
      )}

      <div className="mrb-grid">
        <div className="mrb-panel">
          {!isActive ? (
            <div>
              <label>Starting location (optional)</label>
              <MapboxPlaceSearch
                token={TOKEN}
                placeholder="Where does the route start?"
                proximity={null}
                types="poi,address,place"
                defaultText={startInput}
                onPickPlace={p => chooseStart(p.name || p.street || 'Start', { lat: p.lat, lng: p.lng })}
                onClear={clearStart}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {homeAddress
                  ? <button type="button" className="btn btn-sm" onClick={useHome} disabled={homeBusy || !TOKEN} title={homeAddress}>{homeBusy ? 'Finding home…' : 'Use home'}</button>
                  : <a className="btn btn-sm" href="/settings" style={{ textDecoration: 'none' }}>Set home address</a>}
                <button type="button" className="btn btn-sm" onClick={useMyLocation}>Use my location</button>
                {startPoint && <button type="button" className="btn btn-sm" onClick={() => { clearStart(); }}>Clear start</button>}
              </div>
            </div>
          ) : null}

          <div>
            <label>Add a stop</label>
            <MapboxPlaceSearch
              token={TOKEN}
              placeholder="Type a property name or address, or tap the map"
              proximity={startPoint}
              types="poi,address"
              clearOnPick
              allowFreeText
              localMatches={localMatches}
              onPickPlace={handleSearchPicked}
              onPickText={addTypedStop}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <label style={toggleStyle}>
              <input type="checkbox" style={{ width: 'auto' }} checked={autoOrder} onChange={e => toggleAuto(e.target.checked)} />
              Automatically order for the most efficient drive
            </label>
            {!autoOrder && stops.length > 1 && (
              <button type="button" className="btn btn-sm" onClick={reoptimize}>Re-optimize order</button>
            )}
          </div>
          {autoOrder && stops.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              Ordered by straight-line distance, a free estimate. The route line and times below use real roads.
            </div>
          )}

          <div className="mrb-stops">
            {startPoint && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ ...badgeStyle, background: '#16a34a' }}>S</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{startInput || 'Start'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Start</div>
                </div>
              </div>
            )}
            {stops.map((s, i) => {
              const leg = legs ? legs[startPoint ? i : i - 1] : null;
              const over = stopsDrag.overIndex === i && stopsDrag.dragIndex !== null && stopsDrag.dragIndex !== i;
              return (
                <div
                  key={s.key || `${s.property_id}-${i}`}
                  data-drag-row={i}
                  className={`mrb-stop${over ? ' over' : ''}`}
                  style={{
                    display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--line)',
                    opacity: stopsDrag.dragIndex === i ? 0.4 : 1,
                  }}
                >
                  <button
                    type="button"
                    aria-label="Drag to reorder"
                    onPointerDown={e => stopsDrag.handlePointerDown(e, i)}
                    onPointerMove={stopsDrag.handlePointerMove}
                    onPointerUp={stopsDrag.handlePointerUp}
                    style={dragHandleStyle}
                  >⠿</button>
                  <span style={{ ...badgeStyle, background: s.visited_at ? '#5a7d5a' : INK }}>{s.visited_at ? '✓' : i + 1}</span>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => focusStop(i)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') focusStop(i); }}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, textDecoration: s.visited_at ? 'line-through' : 'none', opacity: s.visited_at ? 0.6 : 1 }}>{s.property_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      {formatStopAddress(s) || 'No address, not shown on the map'}
                      {leg && leg.meters != null ? ` · ${formatMiles(metersToMiles(leg.meters))} mi, ${formatDuration(leg.seconds)} from previous` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 120 }}>
                    <button type="button" className="btn btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => moveStop(i, i - 1)}>▲</button>
                    <button type="button" className="btn btn-sm" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => moveStop(i, i + 1)}>▼</button>
                    {isActive && (s.visited_at ? (
                      <button type="button" className="btn btn-sm" onClick={() => unmarkStopVisited(i)}>Undo</button>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => markStopVisited(i)}>Visited</button>
                    ))}
                    <button type="button" className="btn btn-sm btn-danger" aria-label={`Remove ${s.property_name}`} onClick={() => removeStop(i)}>×</button>
                  </div>
                </div>
              );
            })}
            {stops.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '6px 0' }}>
                No stops yet. Tap a property on the map, then add it, or type a place above.
              </div>
            )}
          </div>
          {stops.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              Drag stops (or use the arrows) to change the order. Editing the order turns automatic ordering off.
            </div>
          )}
          <div style={{ fontSize: 13, minHeight: 20 }}>{summary}</div>
          {routeError && followRoads && (
            <div style={{ fontSize: 11, color: '#a17c3f' }}>{routeError} The line shows straight segments until it clears.</div>
          )}
        </div>

        <div className="mrb-mapcol">
          <div className="mrb-map">
            {!TOKEN ? (
              <div style={{ padding: 24, fontSize: 13, color: 'var(--ink-soft)' }}>
                The map needs a Mapbox public token. Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in Vercel (Project Settings, Environment Variables), then redeploy.
                You can still type places into the box on the left without it.
              </div>
            ) : (
              <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
            )}
            {TOKEN && !mapReady && (
              <div style={overlayPillStyle({ top: 10, left: 10 })}>Loading map…</div>
            )}
            {busy && (
              <div style={overlayPillStyle({ top: 10, left: '50%', transform: 'translateX(-50%)' })}>{busy}</div>
            )}
            {TOKEN && mapReady && (
              <div style={{ ...overlayPillStyle({ bottom: 10, left: 10 }), padding: '8px 10px', pointerEvents: 'none', lineHeight: 1.5 }}>
                {VISIT_BUCKETS.map(b => (
                  <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, border: '1.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)', flexShrink: 0 }} />
                    <span>{b.label}</span>
                    <span style={{ color: 'var(--ink-soft)', marginLeft: 'auto', paddingLeft: 8 }}>{bucketCounts[b.key]}</span>
                  </div>
                ))}
                {!propsLoaded && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Loading properties…</div>}
              </div>
            )}
          </div>

          {TOKEN && mapReady && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <label style={toggleStyle}>
                <input type="checkbox" style={{ width: 'auto' }} checked={followRoads} onChange={e => setFollowRoads(e.target.checked)} />
                Follow roads
              </label>
              <label style={toggleStyle}>
                <input type="checkbox" style={{ width: 'auto' }} checked={showSaved} onChange={e => setShowSaved(e.target.checked)} />
                Show properties
              </label>
              <button type="button" className="btn btn-sm" onClick={fitToStops} disabled={routePoints.length === 0}>Fit route</button>
            </div>
          )}

          {detailStop && (
            <div style={{ border: '1px solid var(--ink, #171714)', borderRadius: 10, padding: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', fontWeight: 700, color: 'var(--ink-soft)' }}>
                    {selectedSaved ? (selectedSaved.property_type || 'SAVED PROPERTY').toUpperCase() : 'NEW SPOT'}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{detailStop.property_name}</div>
                </div>
                <button type="button" className="btn btn-sm" aria-label="Close" onClick={() => setSelected(null)}>×</button>
              </div>
              <div style={{ fontSize: 12, margin: '8px 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
                <span style={{ color: 'var(--ink-soft)' }}>Address</span><span>{formatStopAddress(detailStop) || 'None'}</span>
                {selectedSaved?.management_company && (<><span style={{ color: 'var(--ink-soft)' }}>Managed by</span><span>{selectedSaved.management_company}</span></>)}
                {selectedSaved?.prospect_stage && (<><span style={{ color: 'var(--ink-soft)' }}>Stage</span><span>{selectedSaved.prospect_stage}</span></>)}
                {selectedSaved && (
                  <>
                    <span style={{ color: 'var(--ink-soft)' }}>Last visited</span>
                    <span>{selectedSaved.last_visited_at ? `${daysSince(selectedSaved.last_visited_at)} days ago` : 'Never'}</span>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detailIndex >= 0
                  ? <button type="button" className="btn btn-sm" onClick={removeDetail}>Remove from route</button>
                  : <button type="button" className="btn btn-primary btn-sm" onClick={addDetail}>Add to route</button>}
                {!isActive && <button type="button" className="btn btn-sm" onClick={useDetailAsStart}>Use as start</button>}
                {stopHasCoords(detailStop) && (
                  <a
                    className="btn btn-sm"
                    href={`https://www.google.com/maps/search/?api=1&query=${detailStop.property_lat},${detailStop.property_lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >Open in Google Maps</a>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Properties in view</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{inView.length} of {savedProps.length}</div>
            </div>
            {propsLoaded && savedProps.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>
                No properties have a map location yet.
              </div>
            )}
            {savedProps.length > 0 && inView.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>No properties in this part of the map. Pan or zoom out.</div>
            )}
            <div className="mrb-inview">
              {inView.slice(0, IN_VIEW_LIMIT).map(p => {
                const idx = stopIndexForProperty(p);
                const isSel = selected?.type === 'saved' && selected.id === p.id;
                const bucket = VISIT_BUCKETS[visitBucket(p.last_visited_at)];
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', padding: '8px 0',
                      background: isSel ? 'rgba(155,119,61,0.10)' : 'transparent',
                    }}
                  >
                    <span title={bucket.label} style={{ width: 10, height: 10, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
                    <button
                      type="button"
                      onClick={() => pickSaved(p)}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[p.management_company, p.property_city].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                    {idx >= 0
                      ? <button type="button" className="btn btn-sm" onClick={() => removeStop(idx)} title="Remove from route">✓ On route</button>
                      : <button type="button" className="btn btn-sm" onClick={() => addStop(buildStop({ property: p }), true)}>＋ Add</button>}
                  </div>
                );
              })}
            </div>
            {inView.length > IN_VIEW_LIMIT && (
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                Showing the {IN_VIEW_LIMIT} closest to the map center. Zoom in to narrow the list.
              </div>
            )}
          </div>
        </div>
      </div>

      {notice && <div style={{ fontSize: 12, color: '#a17c3f', marginTop: 12 }}>{notice}</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        {!isActive ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={saveAndStart} disabled={saving || stops.length === 0}>
              {saving ? 'Saving…' : 'Save & Start Route'}
            </button>
            <button className="btn btn-sm" onClick={openInMaps} disabled={stops.length === 0}>Open in Google Maps</button>
            <button className="btn btn-sm" onClick={resetAll} disabled={stops.length === 0 && !startPoint}>Clear</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => setDriving(true)}>Start Driving →</button>
            <button className="btn btn-sm" onClick={openInMaps}>Open Full Route in Google Maps</button>
            <button className="btn btn-sm" onClick={markAllVisited} disabled={marking}>{marking ? 'Marking…' : 'Mark All Visited'}</button>
            <button className="btn btn-sm" onClick={handleFinishRoute}>Finish &amp; Start Over</button>
            <button className="btn btn-sm btn-danger" onClick={discardRoute}>Discard</button>
          </>
        )}
        {onClose && <button className="btn btn-sm" onClick={onClose}>{isActive ? 'Close (keeps this route saved)' : 'Cancel'}</button>}
      </div>

      {driving && isActive && (
        <DriveModeOverlay
          stops={stops}
          endLabel={route?.end_label || null}
          onExit={() => setDriving(false)}
          onMarkVisited={async (index) => { await markStopVisited(index); }}
          onUndoVisit={async (index) => { await unmarkStopVisited(index); }}
          onSkip={skipStop}
          onFinish={handleFinishRoute}
        />
      )}
    </>
  );

  return hideChrome ? body : (
    <div className="card">
      <h3>Create Sales Route</h3>
      {body}
    </div>
  );
}

const toggleStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', margin: 0 };
const badgeStyle = {
  flex: 'none', width: 24, height: 24, borderRadius: '50%', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
};
const dragHandleStyle = {
  padding: '4px 8px', fontSize: 16, lineHeight: 1,
  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
  color: 'var(--ink-soft)', cursor: 'grab', touchAction: 'none', flexShrink: 0,
};
function overlayPillStyle(pos) {
  return {
    position: 'absolute', zIndex: 2, ...pos, fontSize: 12, background: 'var(--card-bg, #fff)',
    padding: '4px 12px', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  };
}
