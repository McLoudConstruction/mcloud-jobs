// Mapbox helpers for the map Route Builder: place search, reverse geocoding,
// driving directions, "when was this last visited" color buckets, and the
// one-time address-to-coordinates backfill. Same Mapbox setup as the
// Overlanding Trip Planner (lib/tripOrder.ts); token comes from
// NEXT_PUBLIC_MAPBOX_TOKEN.

const API = 'https://api.mapbox.com';

/** Mapbox Directions accepts at most 25 points, including the start. */
export const MAPBOX_MAX_POINTS = 25;

// ─── Last-visit color coding ───────────────────────────────────────────
export const VISIT_BUCKETS = [
  { key: 0, label: 'Visited this week', color: '#16a34a' },
  { key: 1, label: 'Visited in the last 30 days', color: '#eab308' },
  { key: 2, label: 'Visited in the last 60 days', color: '#f97316' },
  { key: 3, label: 'Not visited in 60+ days', color: '#dc2626' },
];

/** 0 = within 7 days, 1 = within 30, 2 = within 60, 3 = older than 60 days or never. */
export function visitBucket(lastVisitedIso) {
  if (!lastVisitedIso) return 3;
  const days = Math.floor((Date.now() - new Date(lastVisitedIso).getTime()) / 86400000);
  if (days <= 7) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  return 3;
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ─── Feature parsing (Search Box + Geocoding v6 share this shape) ──────
export function featureToPlace(f) {
  const p = f?.properties || {};
  const ctx = p.context || {};
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  let street = ctx.address?.name || p.address || '';
  if (!street && (p.feature_type === 'address')) street = p.name || '';
  const state = ctx.region?.region_code || String(ctx.region?.region_code_full || '').split('-').pop() || '';
  const isPoi = p.feature_type === 'poi';
  return {
    id: String(p.mapbox_id || f.id || `${c[0]},${c[1]}`),
    name: (isPoi ? p.name : street || p.name) || street || '',
    subtitle: p.place_formatted || p.full_address || '',
    street,
    city: ctx.place?.name || ctx.locality?.name || '',
    state,
    zip: ctx.postcode?.name || '',
    lng: Number(c[0]),
    lat: Number(c[1]),
  };
}

/** Forward search for the "add a stop" and "start" boxes. */
export async function searchPlaces(query, token, proximity, types, signal) {
  const q = (query || '').trim();
  if (q.length < 2 || !token) return [];
  const prox = proximity ? `&proximity=${proximity.lng},${proximity.lat}` : '';
  try {
    const res = await fetch(
      `${API}/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&auto_complete=true&limit=6&country=us&types=${types || 'poi,address'}${prox}&access_token=${token}`,
      { signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(featureToPlace).filter(Boolean);
  } catch {
    return [];
  }
}

/** Street address for a tapped spot. Resolves to null when there isn't one. */
export async function reverseGeocode(lng, lat, token) {
  if (!token) return null;
  try {
    const res = await fetch(
      `${API}/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=address&limit=1&access_token=${token}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const place = featureToPlace(data.features?.[0]);
    return place && place.street ? place : null;
  } catch {
    return null;
  }
}

// ─── Driving directions ────────────────────────────────────────────────
/**
 * Resolves to { route, error }. route = { geometry, meters, seconds, legs: [{meters, seconds}] }.
 * `points` are { lat, lng }, start first.
 */
export async function fetchDirections(points, token, signal) {
  if (!token || points.length < 2) return { route: null, error: null };
  if (points.length > MAPBOX_MAX_POINTS) {
    return { route: null, error: `Mapbox can route at most ${MAPBOX_MAX_POINTS} points at once (including the start).` };
  }
  try {
    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
    const res = await fetch(
      `${API}/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&steps=false&access_token=${token}`,
      { signal }
    );
    const data = await res.json();
    if (!res.ok || data.code !== 'Ok') {
      return { route: null, error: data.message || 'No drivable route found between these points.' };
    }
    const r = data.routes?.[0];
    if (!r) return { route: null, error: 'No drivable route found between these points.' };
    return {
      route: {
        geometry: r.geometry,
        meters: r.distance ?? null,
        seconds: r.duration ?? null,
        legs: (r.legs || []).map(l => ({ meters: l.distance ?? null, seconds: l.duration ?? null })),
      },
      error: null,
    };
  } catch (e) {
    if (e?.name === 'AbortError') return { route: null, error: null };
    return { route: null, error: e?.message || 'Routing failed.' };
  }
}

// ─── One-time coordinates backfill for properties that only have an address ─
/**
 * Address -> coordinates using Mapbox's standard geocoder (free tier, same
 * as the Overlanding Trip Planner). Resolves to { lat, lng } or null when
 * there was no match; throws with `.status` on an HTTP error so the caller
 * can stop early (bad token, rate limit).
 */
export async function geocodeAddress(property, token) {
  const q = [property.property_street, property.property_city, property.property_state, property.property_zip]
    .filter(Boolean).join(', ');
  if (!q || !property.property_street) return null;
  const res = await fetch(
    `${API}/search/geocode/v6/forward?q=${encodeURIComponent(q)}&limit=1&country=us&types=address&autocomplete=false&access_token=${token}`
  );
  if (!res.ok) {
    const err = new Error(`Geocoding failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const c = data.features?.[0]?.geometry?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? { lng: Number(c[0]), lat: Number(c[1]) } : null;
}
