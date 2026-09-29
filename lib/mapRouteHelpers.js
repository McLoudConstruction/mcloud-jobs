// Small shared helpers for the map Route Builder (MapRouteBuilderCore).
import { haversineMiles } from './salesRoutes';

/** Kansas City, [lng, lat] as Mapbox expects. */
export const DEFAULT_MAP_CENTER = [-94.5786, 39.0997];

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

// Straight-line total over [{lat,lng}...], used until the road route arrives.
export function straightLineMiles(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineMiles(points[i - 1], points[i]);
    if (d != null) total += d;
  }
  return total;
}
