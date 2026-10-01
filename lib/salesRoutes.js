'use client';
import { supabase } from './supabaseClient';

// ─── Straight-line distance ordering ────────────────────────────────────
// A free, client-side ESTIMATE — nearest-neighbor by straight-line
// (haversine) distance, not real driving distance/time. Real
// driving-distance optimization would need Google's paid Routes API,
// deliberately skipped here in favor of "good enough for a handful of
// stops, costs nothing."
const EARTH_RADIUS_MI = 3958.8;
function toRad(deg) { return (deg * Math.PI) / 180; }

export function haversineMiles(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

// Greedy nearest-neighbor from `start`, one hop at a time. Stops with no
// coordinates on file (older properties never looked up through Places)
// can't be placed by distance, so they're left in their original
// relative order and appended after every stop that could be ordered.
export function orderStopsForEfficiency(stops, start) {
  const withCoords = stops.filter(s => s.property_lat != null && s.property_lng != null);
  const withoutCoords = stops.filter(s => s.property_lat == null || s.property_lng == null);
  if (!start || withCoords.length === 0) return stops;

  const remaining = [...withCoords];
  const ordered = [];
  let current = start;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDist = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineMiles(current, { lat: s.property_lat, lng: s.property_lng });
      if (d != null && d < bestDist) { bestDist = d; bestIndex = i; }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = { lat: next.property_lat, lng: next.property_lng };
  }
  return [...ordered, ...withoutCoords];
}

// ─── Saved routes (survive the phone screen turning off mid-drive) ─────
export async function getActiveRoute(staffId) {
  if (!staffId) return null;
  const { data } = await supabase
    .from('sales_routes')
    .select('*')
    .eq('staff_id', staffId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function listRouteHistory(staffId, limit = 20) {
  if (!staffId) return [];
  // Most recently touched first, so a route you just saved lands at the
  // top. Saved (not yet driven) routes are always included, so they can
  // never scroll off the list behind newer history.
  const [{ data: recent }, { data: saved }] = await Promise.all([
    supabase.from('sales_routes').select('*')
      .eq('staff_id', staffId).order('updated_at', { ascending: false }).limit(limit),
    supabase.from('sales_routes').select('*')
      .eq('staff_id', staffId).eq('status', 'saved').order('updated_at', { ascending: false }),
  ]);
  const byId = new Map();
  [...(recent || []), ...(saved || [])].forEach(r => byId.set(r.id, r));
  return [...byId.values()].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

// Only one active route per staff member at a time — starting a new one
// retires whatever was in progress (it stays in history as 'canceled',
// nothing is deleted).
export async function startRoute({ staffId, startLabel, start, endLabel, end, stops, autoOrdered, timing }) {
  await supabase.from('sales_routes')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('staff_id', staffId).eq('status', 'active');

  const { data, error } = await supabase.from('sales_routes').insert({
    staff_id: staffId,
    status: 'active',
    start_label: startLabel || null,
    start_lat: start?.lat ?? null,
    start_lng: start?.lng ?? null,
    end_label: endLabel || null,
    end_lat: end?.lat ?? null,
    end_lng: end?.lng ?? null,
    auto_ordered: !!autoOrdered,
    stops,
    ...timingColumns(timing),
  }).select().single();
  if (error) throw error;
  return data;
}

// Timing columns written with a route. `timing` is optional:
// { defaultDwell, departTime: 'HH:MM', estMeters, estSeconds }. Anything not
// passed is left out so the column default (or the current value) stands.
function timingColumns(timing) {
  if (!timing) return {};
  const out = {};
  if (timing.defaultDwell != null && Number.isFinite(Number(timing.defaultDwell))) {
    out.default_dwell_minutes = Math.max(0, Math.round(Number(timing.defaultDwell)));
  }
  if (timing.departTime !== undefined) out.depart_time = timing.departTime || null;
  if (timing.estMeters !== undefined) out.est_meters = timing.estMeters ?? null;
  if (timing.estSeconds !== undefined) out.est_drive_seconds = timing.estSeconds ?? null;
  return out;
}

export async function updateRouteTiming(routeId, timing) {
  const cols = timingColumns(timing);
  if (Object.keys(cols).length === 0) return null;
  const { data, error } = await supabase
    .from('sales_routes')
    .update({ ...cols, updated_at: new Date().toISOString() })
    .eq('id', routeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRouteById(routeId) {
  if (!routeId) return null;
  const { data, error } = await supabase.from('sales_routes').select('*').eq('id', routeId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Routes still to be driven: the one in progress first, then saved ones,
// most recently touched first within each group.
export async function listOpenRoutes(staffId) {
  if (!staffId) return [];
  const { data, error } = await supabase.from('sales_routes').select('*')
    .eq('staff_id', staffId).in('status', ['active', 'saved'])
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  return [...rows.filter(r => r.status === 'active'), ...rows.filter(r => r.status === 'saved')];
}

export async function updateRouteStops(routeId, stops) {
  const { data, error } = await supabase
    .from('sales_routes')
    .update({ stops, updated_at: new Date().toISOString() })
    .eq('id', routeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Saved routes ───────────────────────────────────────────────────────
// A saved route is built but not being driven. Any number can be saved;
// none of them touch the one active route. Saved stops keep whatever
// visited_at they already have, so a route set aside mid-drive resumes
// where it left off.

// Saves a route that was built in the builder, without starting it.
export async function saveRoute({ staffId, startLabel, start, endLabel, end, stops, autoOrdered, timing }) {
  const { data, error } = await supabase.from('sales_routes').insert({
    staff_id: staffId,
    status: 'saved',
    start_label: startLabel || null,
    start_lat: start?.lat ?? null,
    start_lng: start?.lng ?? null,
    end_label: endLabel || null,
    end_lat: end?.lat ?? null,
    end_lng: end?.lng ?? null,
    auto_ordered: !!autoOrdered,
    stops,
    ...timingColumns(timing),
  }).select().single();
  if (error) throw error;
  return data;
}

// Sets an in-progress route aside as a saved one.
export async function shelveRoute(routeId) {
  const { error } = await supabase.from('sales_routes')
    .update({ status: 'saved', updated_at: new Date().toISOString() })
    .eq('id', routeId).eq('status', 'active');
  if (error) throw error;
}

// Makes a saved route the active one. Whatever is active right now is set
// aside as saved rather than canceled, so no progress is lost.
export async function activateSavedRoute(route) {
  const now = new Date().toISOString();
  const { error: shelveErr } = await supabase.from('sales_routes')
    .update({ status: 'saved', updated_at: now })
    .eq('staff_id', route.staff_id).eq('status', 'active');
  if (shelveErr) throw shelveErr;
  const { data, error } = await supabase.from('sales_routes')
    .update({ status: 'active', updated_at: now })
    .eq('id', route.id).eq('status', 'saved')
    .select().single();
  if (error) throw error;
  return data;
}

export async function finishRoute(routeId) {
  await supabase.from('sales_routes').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', routeId);
}

export async function cancelRoute(routeId) {
  await supabase.from('sales_routes').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', routeId);
}

export async function deleteRoute(routeId) {
  const { error } = await supabase.from('sales_routes').delete().eq('id', routeId);
  if (error) throw error;
}

// Starts a brand-new active route from a past one's stops — same
// property list, same start/end and auto-order setting, every stop reset
// to not-visited. Goes through startRoute, so (same as building any new
// route) whatever's currently active gets retired first.
export async function repeatRoute(route) {
  const stops = (route.stops || []).map(s => ({ ...s, visited_at: null, skipped_at: null }));
  return startRoute({
    staffId: route.staff_id,
    startLabel: route.start_label,
    start: route.start_lat != null && route.start_lng != null ? { lat: route.start_lat, lng: route.start_lng } : null,
    endLabel: route.end_label,
    end: route.end_lat != null && route.end_lng != null ? { lat: route.end_lat, lng: route.end_lng } : null,
    stops,
    autoOrdered: !!route.auto_ordered,
    timing: {
      defaultDwell: route.default_dwell_minutes,
      departTime: route.depart_time,
      estMeters: route.est_meters,
      estSeconds: route.est_drive_seconds,
    },
  });
}

// ─── Browser geolocation (free — no Google API involved) ───────────────
export function getCurrentLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // denied/unavailable — caller falls back to entered order
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

// ─── Preferred maps app for turn-by-turn (per-device, remembered locally) ─
const MAPS_PROVIDER_KEY = 'mcloud_preferred_maps_provider';

export function getPreferredMapsProvider() {
  try {
    return localStorage.getItem(MAPS_PROVIDER_KEY) || 'apple';
  } catch {
    return 'apple';
  }
}

export function setPreferredMapsProvider(provider) {
  try { localStorage.setItem(MAPS_PROVIDER_KEY, provider); } catch { /* ignore — device convenience only */ }
}

export function mapsUrlFor(provider, address) {
  const encoded = encodeURIComponent(address);
  switch (provider) {
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
    case 'waze': return `https://waze.com/ul?q=${encoded}&navigate=yes`;
    case 'apple':
    default: return `https://maps.apple.com/?daddr=${encoded}`;
  }
}
