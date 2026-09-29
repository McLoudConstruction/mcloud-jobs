'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { loadGoogleMapsPlaces } from '../lib/googleMapsLoader';
import PlacesAutocompleteInput from './PlacesAutocompleteInput';
import DriveModeOverlay from './DriveModeOverlay';
import { findOrCreatePropertyForRouteStop } from '../lib/contactSync';
import { useDragReorder } from '../lib/useDragReorder';
import {
  getActiveRoute, startRoute, updateRouteStops, finishRoute, cancelRoute,
  getCurrentLocation, haversineMiles,
} from '../lib/salesRoutes';
import { orderStops, cheapestInsertionIndex, pointsKey } from '../lib/routeOrdering';
import {
  DEFAULT_MAP_CENTER, buildStop, stopHasCoords, formatStopAddress,
  reverseGeocode, placeFromPlaceId, metersToMiles, formatMiles, formatDuration,
  straightLineMiles, computeRoadRoute, MAX_ROAD_ROUTE_POINTS,
} from '../lib/mapRouteHelpers';

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
const SAVED_PROPERTY_LIMIT = 800;
const IN_VIEW_LIMIT = 100;
const ROUTE_DEBOUNCE_MS = 500;
const DUPLICATE_RADIUS_MILES = 0.02; // ~30 m, a second tap on the same building
const INK = '#1C1B19';
const SLATE = '#2F4858';
const GOLD = '#9B773D';
const RUST = '#A8471F';

function stripKey({ key, ...rest }) {
  return rest;
}

function stopLatLng(s) {
  return { lat: s.property_lat, lng: s.property_lng };
}

function sameStop(a, b) {
  if (a.property_id && b.property_id && a.property_id === b.property_id) return true;
  const sa = (a.property_street || '').trim().toLowerCase();
  const sb = (b.property_street || '').trim().toLowerCase();
  if (sa && sb && sa === sb && (a.property_zip || '') === (b.property_zip || '')) return true;
  if (stopHasCoords(a) && stopHasCoords(b)) {
    const d = haversineMiles(stopLatLng(a), stopLatLng(b));
    if (d != null && d < DUPLICATE_RADIUS_MILES) return true;
  }
  return false;
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function pinElement(label, kind) {
  const el = document.createElement('div');
  el.textContent = label;
  const bg = kind === 'start' ? '#16a34a' : kind === 'visited' ? '#5a7d5a' : INK;
  el.style.cssText = [
    'width:26px', 'height:26px', 'border-radius:50%', 'box-sizing:border-box',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:700 12px/1 system-ui,sans-serif', 'color:#fff', `background:${bg}`,
    'border:2px solid #fff', 'box-shadow:0 2px 6px rgba(0,0,0,0.4)', 'cursor:pointer',
  ].join(';');
  return el;
}

// Map-first Sales Route builder, modeled on the Overlanding Trip Planner's
// trip screen. You work the map: tap one of your saved properties (or any
// building or spot) to select it, read its card, and add it to the route.
// A "saved properties in view" list follows whatever the map is showing, and
// the route line, mileage and per-leg times redraw as the stop list changes.
//
// Stops are ordered automatically for the most efficient drive (exact up to
// 12 stops, heuristic beyond) until you reorder by hand; "Re-optimize order"
// hands control back. New stops slot in where they add the least driving.
//
// Saves into the same sales_routes flow as the typed builder, so Drive Mode,
// resume-after-screen-off and Recent Routes work unchanged.
//
// Road routing (route line, drive time, per-leg times) uses Google's Routes
// library and needs the Routes API enabled on the same key as Maps/Places.
// If it isn't, or a request fails, the line falls back to straight segments.
// Ordering itself never calls a paid API.
export default function MapRouteBuilderCore({ onClose, onRouteChanged, hideChrome }) {
  const [staffId, setStaffId] = useState(null);
  const [checkingActive, setCheckingActive] = useState(true);
  const [route, setRoute] = useState(null); // saved sales_routes row once started/resumed
  const [stops, setStops] = useState([]);
  const [mapStatus, setMapStatus] = useState('loading'); // loading | ready | nokey
  const [search, setSearch] = useState('');
  const [startInput, setStartInput] = useState('');
  const [startPoint, setStartPoint] = useState(null); // { lat, lng }
  const [autoOrder, setAutoOrder] = useState(true);
  const [followRoads, setFollowRoads] = useState(true);
  const [showSaved, setShowSaved] = useState(true);
  const [savedProps, setSavedProps] = useState([]);
  const [selected, setSelected] = useState(null); // { type: 'saved', id } | { type: 'spot', stop }
  const [bounds, setBounds] = useState(null);
  const [roadRoute, setRoadRoute] = useState(null); // { key, path, meters, seconds, legs }
  const [routeBusy, setRouteBusy] = useState(false);
  const [roadFailed, setRoadFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [driving, setDriving] = useState(false);
  const [marking, setMarking] = useState(false);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const spotMarkerRef = useRef(null);
  const linesRef = useRef([]);
  const routeReqRef = useRef(0);
  const clickHandlerRef = useRef(null);
  const dataClickAtRef = useRef(0);
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
        const active = await getActiveRoute(id);
        if (!cancelled && active && (active.stops || []).length > 0) {
          setRoute(active);
          setStops(active.stops);
          setAutoOrder(false); // never reshuffle a route already in progress
          if (active.start_lat != null && active.start_lng != null) {
            setStartPoint({ lat: active.start_lat, lng: active.start_lng });
            setStartInput(active.start_label || 'Your current location');
          }
        }
      }
      if (!cancelled) setCheckingActive(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Saved properties (the Property Database, as selectable points) ────
  useEffect(() => {
    let cancelled = false;
    supabase.from('properties')
      .select('id, property_name, property_type, management_company, property_street, property_city, property_state, property_zip, property_lat, property_lng, prospect_stage, last_visited_at')
      .not('property_lat', 'is', null)
      .not('property_lng', 'is', null)
      .not('prospect_stage', 'in', '("won","lost")')
      .limit(SAVED_PROPERTY_LIMIT)
      .then(({ data }) => { if (!cancelled) setSavedProps(data || []); });
    return () => { cancelled = true; };
  }, []);

  // ── Create the map once the container is on screen ────────────────────
  useEffect(() => {
    if (checkingActive) return undefined;
    let cancelled = false;
    (async () => {
      const loaded = await loadGoogleMapsPlaces();
      if (cancelled) return;
      if (!loaded) { setMapStatus('nokey'); return; }
      const { Map } = await window.google.maps.importLibrary('maps');
      await window.google.maps.importLibrary('marker');
      if (cancelled || !mapDivRef.current) return;
      const map = new Map(mapDivRef.current, {
        center: DEFAULT_MAP_CENTER,
        zoom: 11,
        mapId: MAP_ID,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: true,
        gestureHandling: 'greedy',
      });

      // Saved properties live in the Data layer: one cheap circle each,
      // clickable, restyled from feature properties.
      map.data.setStyle(f => {
        if (f.getProperty('inRoute')) return { visible: false };
        const sel = !!f.getProperty('selected');
        return {
          clickable: true,
          zIndex: sel ? 5 : 1,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: sel ? 9 : 6,
            fillColor: sel ? GOLD : SLATE,
            fillOpacity: 1,
            strokeColor: sel ? INK : '#ffffff',
            strokeWeight: sel ? 3 : 2,
          },
        };
      });
      map.data.addListener('click', ev => {
        dataClickAtRef.current = Date.now();
        setNotice('');
        setSelected({ type: 'saved', id: ev.feature.getProperty('id') });
      });

      map.addListener('click', e => { if (clickHandlerRef.current) clickHandlerRef.current(e); });
      map.addListener('idle', () => {
        const b = map.getBounds();
        if (!b) return;
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        setBounds({ north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() });
      });
      mapRef.current = map;
      setMapStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [checkingActive]);

  const fitToStops = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = [
      ...(startRef.current ? [startRef.current] : []),
      ...stopsRef.current.filter(stopHasCoords).map(stopLatLng),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) { map.panTo(pts[0]); map.setZoom(15); return; }
    const b = new window.google.maps.LatLngBounds();
    pts.forEach(p => b.extend(p));
    map.fitBounds(b, 60);
  }, []);

  // Frame a resumed route once, as soon as both the map and stops exist.
  useEffect(() => {
    if (mapStatus === 'ready' && !framedRef.current && stops.length > 0) {
      framedRef.current = true;
      fitToStops();
    }
  }, [mapStatus, stops, fitToStops]);

  // ── Saved-property layer: rebuild on data change, restyle on state ────
  useEffect(() => {
    if (mapStatus !== 'ready') return;
    const map = mapRef.current;
    const toRemove = [];
    map.data.forEach(f => toRemove.push(f));
    toRemove.forEach(f => map.data.remove(f));
    map.data.addGeoJson({
      type: 'FeatureCollection',
      features: savedProps.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.property_lng, p.property_lat] },
        properties: { id: p.id, inRoute: 0, selected: 0 },
      })),
    });
  }, [savedProps, mapStatus]);

  useEffect(() => {
    if (mapStatus !== 'ready') return;
    const map = mapRef.current;
    const onRoute = new Set(stops.map(s => s.property_id).filter(Boolean));
    const selId = selected?.type === 'saved' ? selected.id : null;
    map.data.forEach(f => {
      const id = f.getProperty('id');
      const inRoute = onRoute.has(id) ? 1 : 0;
      const sel = id === selId ? 1 : 0;
      if (f.getProperty('inRoute') !== inRoute) f.setProperty('inRoute', inRoute);
      if (f.getProperty('selected') !== sel) f.setProperty('selected', sel);
    });
  }, [savedProps, stops, selected, mapStatus]);

  useEffect(() => {
    if (mapStatus !== 'ready') return;
    mapRef.current.data.setMap(showSaved ? mapRef.current : null);
  }, [showSaved, mapStatus]);

  // ── Persisting and resolving stops ────────────────────────────────────
  // Nothing touches the Property Database until "Save & Start Route", so
  // exploring the map and discarding a draft leaves no stray properties.
  // Once a route is active, each added stop is resolved right away since
  // it is persisted immediately.
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
    if (lastVisited) return stopLatLng(lastVisited);
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
    const pointCount = current.length + (startRef.current ? 1 : 0);
    if (pointCount >= MAX_ROAD_ROUTE_POINTS) {
      setNotice(`A route can have at most ${MAX_ROAD_ROUTE_POINTS - (startRef.current ? 1 : 0)} stops${startRef.current ? ' with a starting location' : ''}.`);
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

  // Tapping a business icon or an empty spot selects it (address looked up)
  // and opens its card; nothing is added until you say so.
  clickHandlerRef.current = async (e) => {
    if (!e?.latLng || driving) return;
    if (Date.now() - dataClickAtRef.current < 100) return; // that tap was on a saved-property circle
    if (e.placeId && typeof e.stop === 'function') e.stop(); // suppress Google's own info window
    setBusy('Finding address…');
    setError('');
    setNotice('');
    try {
      let found = null;
      if (e.placeId) {
        try { found = await placeFromPlaceId(e.placeId); } catch { found = null; }
      }
      if (!found || !found.street) {
        found = await reverseGeocode({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      }
      if (!found || !found.street) {
        setNotice('No street address found there. Tap a building, a business icon, or a spot on a road.');
        return;
      }
      setSelected({
        type: 'spot',
        stop: buildStop({
          name: found.name, street: found.street, city: found.city, state: found.state,
          zip: found.zip, lat: found.lat ?? e.latLng.lat(), lng: found.lng ?? e.latLng.lng(),
        }),
      });
    } catch {
      setNotice('Could not look up an address for that spot. Check that the Geocoding API is enabled for your Google Maps key.');
    } finally {
      setBusy('');
    }
  };

  function handleSearchPicked(place) {
    setSearch('');
    const map = mapRef.current;
    if (map && place.lat != null) { map.panTo({ lat: place.lat, lng: place.lng }); map.setZoom(16); }
    if (!place.street) {
      setNotice('That result has no street address, so it was not added. Tap the building on the map instead.');
      return;
    }
    addStop(buildStop({
      name: place.name, street: place.street, city: place.city, state: place.state,
      zip: place.zip, lat: place.lat, lng: place.lng,
    }), false);
  }

  // Saved properties matching what's typed in the search box, offered
  // alongside Google's suggestions (same idea as saved campsites in the trip planner).
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return savedProps
      .filter(p => `${p.property_name} ${p.property_street || ''} ${p.property_city || ''}`.toLowerCase().includes(q))
      .slice(0, 4);
  }, [savedProps, search]);

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
    if (map && s && stopHasCoords(s)) { map.panTo(stopLatLng(s)); map.setZoom(Math.max(map.getZoom() || 0, 15)); }
  }

  // ── Derived: route points, drawn route, totals ────────────────────────
  const routePoints = useMemo(
    () => [...(startPoint ? [startPoint] : []), ...stops.filter(stopHasCoords).map(stopLatLng)],
    [startPoint, stops]
  );
  const routeKey = useMemo(() => pointsKey(routePoints), [routePoints]);
  const roadInSync = !!roadRoute && roadRoute.key === routeKey;
  const allPlaced = stops.every(stopHasCoords);

  // Keep the road route in sync with the ordered stops (debounced; a newer
  // edit supersedes an older request).
  useEffect(() => {
    if (mapStatus !== 'ready') return undefined;
    if (!followRoads || routePoints.length < 2 || routePoints.length > MAX_ROAD_ROUTE_POINTS) {
      routeReqRef.current++;
      setRouteBusy(false);
      return undefined;
    }
    if (roadRouteRef.current && roadRouteRef.current.key === routeKey) {
      setRouteBusy(false);
      return undefined;
    }
    const id = ++routeReqRef.current;
    setRouteBusy(true);
    const timer = setTimeout(async () => {
      try {
        const result = await computeRoadRoute(routePoints);
        if (id !== routeReqRef.current) return;
        setRoadFailed(false);
        setRoadRoute({ key: routeKey, ...result });
        if (fitAfterRouteRef.current) fitToStops();
      } catch {
        if (id !== routeReqRef.current) return;
        setRoadFailed(true); // Routes API off for this key, quota, offline: keep the straight line
      } finally {
        if (id === routeReqRef.current) setRouteBusy(false);
      }
    }, ROUTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, followRoads, mapStatus]);

  // Draw the route: straight segments while a road route is pending or
  // unavailable, white-cased road line once it matches the current stops.
  useEffect(() => {
    if (mapStatus !== 'ready') return undefined;
    const map = mapRef.current;
    linesRef.current.forEach(l => l.setMap(null));
    linesRef.current = [];
    if (routePoints.length < 2) return undefined;
    const g = window.google.maps;
    if (roadInSync && followRoads) {
      linesRef.current = [
        new g.Polyline({ map, path: roadRoute.path, strokeColor: '#ffffff', strokeOpacity: 0.9, strokeWeight: 8, zIndex: 1 }),
        new g.Polyline({ map, path: roadRoute.path, strokeColor: INK, strokeOpacity: 1, strokeWeight: 4, zIndex: 2 }),
      ];
    } else {
      linesRef.current = [
        new g.Polyline({ map, path: routePoints, strokeColor: INK, strokeOpacity: 0.45, strokeWeight: 3, zIndex: 1 }),
      ];
    }
    return () => {
      linesRef.current.forEach(l => l.setMap(null));
      linesRef.current = [];
    };
  }, [roadInSync, roadRoute, routePoints, followRoads, mapStatus]);

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
    if (mapStatus !== 'ready') return undefined;
    const { AdvancedMarkerElement } = window.google.maps.marker;
    const map = mapRef.current;
    stopMarkersRef.current.forEach(m => { m.map = null; });
    stopMarkersRef.current = [];
    if (startPoint) {
      stopMarkersRef.current.push(new AdvancedMarkerElement({
        map, position: startPoint, content: pinElement('S', 'start'), title: startInput || 'Start', zIndex: 900,
      }));
    }
    stops.forEach((s, i) => {
      if (!stopHasCoords(s)) return;
      stopMarkersRef.current.push(new AdvancedMarkerElement({
        map,
        position: stopLatLng(s),
        content: pinElement(s.visited_at ? '✓' : String(i + 1), s.visited_at ? 'visited' : 'stop'),
        title: `${i + 1}. ${s.property_name}`,
        zIndex: 1000 + i,
      }));
    });
    return () => {
      stopMarkersRef.current.forEach(m => { m.map = null; });
      stopMarkersRef.current = [];
    };
  }, [stops, startPoint, startInput, mapStatus]);

  // Marker for a tapped building or spot that isn't added yet.
  useEffect(() => {
    if (mapStatus !== 'ready') return undefined;
    const { AdvancedMarkerElement, PinElement } = window.google.maps.marker;
    if (spotMarkerRef.current) { spotMarkerRef.current.map = null; spotMarkerRef.current = null; }
    if (selected?.type !== 'spot' || !stopHasCoords(selected.stop)) return undefined;
    const pin = new PinElement({ background: RUST, borderColor: '#ffffff', glyphColor: '#ffffff' });
    spotMarkerRef.current = new AdvancedMarkerElement({
      map: mapRef.current, position: stopLatLng(selected.stop), content: pin.element, title: selected.stop.property_name, zIndex: 800,
    });
    return () => {
      if (spotMarkerRef.current) { spotMarkerRef.current.map = null; spotMarkerRef.current = null; }
    };
  }, [selected, mapStatus]);

  // ── Saved properties in the current map view ─────────────────────────
  const inView = useMemo(() => {
    if (!bounds) return [];
    const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
    return savedProps
      .filter(p => p.property_lat >= bounds.south && p.property_lat <= bounds.north
        && p.property_lng >= bounds.west && p.property_lng <= bounds.east)
      .map(p => ({ p, d: haversineMiles(center, { lat: p.property_lat, lng: p.property_lng }) ?? Infinity }))
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
    if (map) { map.panTo({ lat: p.property_lat, lng: p.property_lng }); map.setZoom(Math.max(map.getZoom() || 0, 13)); }
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
    chooseStart(detailStop.property_name, stopLatLng(detailStop));
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
    if (stops.length === 0) { setError('Add at least one stop from the map or the search box.'); return; }
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
    if (stop.property_id) await supabase.from('properties').update({ last_visited_at: nowIso }).eq('id', stop.property_id);
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
    if (ids.length) await supabase.from('properties').update({ last_visited_at: nowIso }).in('id', ids);
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
      {stops.length === 0 ? 'Add a stop from the map or the search box.' : 'Add a start or a second stop to build the route.'}
    </span>
  );

  const body = (
    <>
      <style>{`
        .mrb-grid { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
        .mrb-panel { display: flex; flex-direction: column; gap: 10px; max-height: 760px; overflow-y: auto; }
        .mrb-map { position: relative; height: 560px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; background: #e8e4da; }
        .mrb-inview { max-height: 260px; overflow-y: auto; }
        .mrb-stop.over { box-shadow: 0 -3px 0 #16a34a inset; }
        @media (max-width: 900px) {
          .mrb-grid { grid-template-columns: 1fr; }
          .mrb-mapcol { order: 1; }
          .mrb-panel { order: 2; max-height: none; }
          .mrb-map { height: 400px; }
        }
      `}</style>

      {isActive && stops.length > 0 && (
        <div style={{ fontSize: 12, color: '#a17c3f', marginBottom: 10 }}>
          Route in progress: {remainingCount} of {stops.length} stop{stops.length === 1 ? '' : 's'} left. Tap the map to add more.
        </div>
      )}

      <div className="mrb-grid">
        <div className="mrb-panel">
          {!isActive ? (
            <div>
              <label>Starting location (optional)</label>
              <PlacesAutocompleteInput
                value={startInput}
                onChange={v => { setStartInput(v); if (!v) setStartPoint(null); }}
                onPlaceSelected={p => { if (p.lat != null) chooseStart(p.name || p.street || 'Start', { lat: p.lat, lng: p.lng }); }}
                placeholder="Where does the route start?"
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-sm" onClick={useMyLocation}>Use my location</button>
                {startPoint && <button type="button" className="btn btn-sm" onClick={clearStart}>Clear start</button>}
              </div>
            </div>
          ) : null}

          <div>
            <label>Add a stop</label>
            <PlacesAutocompleteInput
              value={search}
              onChange={setSearch}
              onPlaceSelected={handleSearchPicked}
              placeholder="Search a business or address"
            />
            {searchMatches.length > 0 && (
              <div style={{ marginTop: 6, border: '1px solid var(--line)', borderRadius: 6 }}>
                {searchMatches.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderTop: '1px solid var(--line)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⌂ {p.property_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Saved property{p.property_city ? ` · ${p.property_city}` : ''}</div>
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); pickSaved(p); addStop(buildStop({ property: p }), false); }}>＋ Add</button>
                  </div>
                ))}
              </div>
            )}
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

          <div>
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
                      {formatStopAddress(s) || 'No address on file'}
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
                No stops yet. Tap a saved property or a building on the map, then add it. You can also search above.
              </div>
            )}
          </div>
          {stops.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              Drag stops (or use the arrows) to change the order. Editing the order turns automatic ordering off.
            </div>
          )}
          <div style={{ fontSize: 13, minHeight: 20 }}>{summary}</div>
          {roadFailed && followRoads && (
            <div style={{ fontSize: 11, color: '#a17c3f' }}>
              Road routing is unavailable right now (check that the Routes API is enabled for your Google Maps key), so the line shows straight segments.
            </div>
          )}
        </div>

        <div className="mrb-mapcol">
          <div className="mrb-map">
            {mapStatus === 'nokey' ? (
              <div style={{ padding: 24, fontSize: 13, color: 'var(--ink-soft)' }}>
                The map needs a Google Maps API key. Add one under Settings → Integrations, then reload this page. The Typed List mode above still works without it.
              </div>
            ) : (
              <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
            )}
            {mapStatus === 'loading' && (
              <div style={overlayPillStyle({ top: 10, left: 10 })}>Loading map…</div>
            )}
            {busy && (
              <div style={overlayPillStyle({ top: 10, left: '50%', transform: 'translateX(-50%)' })}>{busy}</div>
            )}
          </div>

          {mapStatus === 'ready' && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <label style={toggleStyle}>
                <input type="checkbox" style={{ width: 'auto' }} checked={followRoads} onChange={e => setFollowRoads(e.target.checked)} />
                Follow roads
              </label>
              <label style={toggleStyle}>
                <input type="checkbox" style={{ width: 'auto' }} checked={showSaved} onChange={e => setShowSaved(e.target.checked)} />
                Show saved properties
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
              <div style={{ fontSize: 14, fontWeight: 700 }}>Saved properties in view</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{inView.length} of {savedProps.length}</div>
            </div>
            {savedProps.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>
                No saved properties with map coordinates yet. Properties you add from an address search get them automatically.
              </div>
            )}
            {savedProps.length > 0 && inView.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>No saved properties in this part of the map. Pan or zoom out.</div>
            )}
            <div className="mrb-inview">
              {inView.slice(0, IN_VIEW_LIMIT).map(p => {
                const idx = stopIndexForProperty(p);
                const isSel = selected?.type === 'saved' && selected.id === p.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', padding: '8px 0',
                      background: isSel ? 'rgba(155,119,61,0.10)' : 'transparent',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => pickSaved(p)}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[p.property_type, p.property_city].filter(Boolean).join(' · ')}
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
    position: 'absolute', ...pos, fontSize: 12, background: 'var(--card-bg, #fff)',
    padding: '4px 12px', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  };
}
