'use client';
// Small helpers for the map-based Route Builder (MapRouteBuilderCore).
// Everything here talks to the Google Maps JS API that
// lib/googleMapsLoader.js has already put on the page, so callers must
// have awaited loadGoogleMapsPlaces() (and gotten `true`) first.
import { haversineMiles } from './salesRoutes';

const KC_CENTER = { lat: 39.0997, lng: -94.5786 };
export const DEFAULT_MAP_CENTER = KC_CENTER;

export function newStopKey() {
  return Math.random().toString(36).slice(2);
}

// The same stop shape sales_routes.stops already stores (see
// ManualRouteBuilderCore), plus a client-only `key` so a draft stop can be
// told apart before it has a property_id.
export function buildStop({ property, name, street, city, state, zip, lat, lng }) {
  if (property) {
    return {
      key: newStopKey(),
      property_id: property.id,
      property_name: property.property_name,
      property_type: property.property_type || null,
      management_company: property.management_company || null,
      property_street: property.property_street || null,
      property_city: property.property_city || null,
      property_state: property.property_state || null,
      property_zip: property.property_zip || null,
      property_lat: property.property_lat ?? null,
      property_lng: property.property_lng ?? null,
      visited_at: null,
    };
  }
  return {
    key: newStopKey(),
    property_id: null,
    property_name: name || street || '',
    property_type: null,
    management_company: null,
    property_street: street || null,
    property_city: city || null,
    property_state: state || null,
    property_zip: zip || null,
    property_lat: lat ?? null,
    property_lng: lng ?? null,
    visited_at: null,
  };
}

export function stopHasCoords(s) {
  return s.property_lat != null && s.property_lng != null;
}

export function formatStopAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

// ─── Reverse geocoding (click on empty map → street address) ───────────
function geocoderComponent(components, type, useShort) {
  const c = (components || []).find(comp => (comp.types || []).includes(type));
  if (!c) return '';
  return useShort ? (c.short_name || c.long_name || '') : (c.long_name || c.short_name || '');
}

export async function reverseGeocode(latLng) {
  const { Geocoder } = await window.google.maps.importLibrary('geocoding');
  const geocoder = new Geocoder();
  const { results } = await geocoder.geocode({ location: latLng });
  if (!results || results.length === 0) return null;
  // Prefer a result that actually has a street number, since the first result
  // is sometimes just a road segment or a neighborhood.
  const best = results.find(r => (r.address_components || []).some(c => c.types.includes('street_number'))) || results[0];
  const comps = best.address_components || [];
  const street = [geocoderComponent(comps, 'street_number'), geocoderComponent(comps, 'route')].filter(Boolean).join(' ');
  if (!street) return null;
  return {
    name: street,
    street,
    city: geocoderComponent(comps, 'locality') || geocoderComponent(comps, 'sublocality') || geocoderComponent(comps, 'administrative_area_level_2'),
    state: geocoderComponent(comps, 'administrative_area_level_1', true),
    zip: geocoderComponent(comps, 'postal_code'),
    lat: latLng.lat,
    lng: latLng.lng,
  };
}

// ─── Clicking a business / landmark icon on the map ────────────────────
function placeComponent(components, type, useShort) {
  const c = (components || []).find(comp => (comp.types || []).includes(type));
  if (!c) return '';
  return useShort ? (c.shortText || c.longText || '') : (c.longText || c.shortText || '');
}

function textOf(field) {
  if (!field) return '';
  return typeof field === 'string' ? field : (field.text || '');
}

export async function placeFromPlaceId(placeId) {
  const { Place } = await window.google.maps.importLibrary('places');
  const place = new Place({ id: placeId });
  await place.fetchFields({ fields: ['addressComponents', 'displayName', 'location'] });
  const comps = place.addressComponents || [];
  const street = [placeComponent(comps, 'street_number'), placeComponent(comps, 'route')].filter(Boolean).join(' ');
  const loc = place.location;
  return {
    name: textOf(place.displayName) || street,
    street,
    city: placeComponent(comps, 'locality') || placeComponent(comps, 'sublocality') || placeComponent(comps, 'administrative_area_level_2'),
    state: placeComponent(comps, 'administrative_area_level_1', true),
    zip: placeComponent(comps, 'postal_code'),
    lat: typeof loc?.lat === 'function' ? loc.lat() : (loc?.lat ?? null),
    lng: typeof loc?.lng === 'function' ? loc.lng() : (loc?.lng ?? null),
  };
}

// ─── Distance / time display ───────────────────────────────────────────
export function metersToMiles(m) {
  return m / 1609.344;
}

export function formatMiles(miles) {
  if (miles == null) return '';
  return miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
}

export function formatDuration(seconds) {
  if (seconds == null) return '';
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// Straight-line total, used when road routing isn't available.
export function straightLineMiles(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineMiles(points[i - 1], points[i]);
    if (d != null) total += d;
  }
  return total;
}

// Road routing through Google's Routes library. Resolves to
// { path: [{lat,lng}...], meters, seconds, legs } or throws. Callers fall back
// to a straight-line polyline, so a key without Routes API enabled (or a
// quota hiccup) never breaks the builder, it just looks less precise.
export const MAX_ROAD_ROUTE_POINTS = 27; // origin + destination + 25 intermediates
export async function computeRoadRoute(points) {
  const { Route } = await window.google.maps.importLibrary('routes');
  if (!Route || typeof Route.computeRoutes !== 'function') throw new Error('Routes library unavailable');
  const [origin, ...rest] = points;
  const destination = rest[rest.length - 1];
  const intermediates = rest.slice(0, -1);
  const { routes } = await Route.computeRoutes({
    origin,
    destination,
    intermediates,
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis', 'legs'],
  });
  const r = routes && routes[0];
  if (!r || !r.path || r.path.length === 0) throw new Error('No route returned');
  return {
    path: r.path.map(p => (typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : p)),
    meters: r.distanceMeters ?? null,
    seconds: r.durationMillis != null ? r.durationMillis / 1000 : null,
    // One entry per hop between consecutive points (start, then each stop).
    legs: (r.legs || []).map(l => ({
      meters: l.distanceMeters ?? null,
      seconds: l.durationMillis != null ? l.durationMillis / 1000 : null,
    })),
  };
}

export function brandColor() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    return v || '#9B773D';
  } catch {
    return '#9B773D';
  }
}
