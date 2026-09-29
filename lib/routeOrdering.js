// Stop ordering for the Route Builder, ported from the Overlanding Trip
// Planner's lib/tripOrder.ts (same algorithms, same behavior):
//   * exact best-open-path (Held-Karp) up to 12 stops,
//     nearest-neighbor + 2-opt + or-opt beyond that
//   * "cheapest insertion" for dropping a new stop in without disturbing a
//     hand-picked order
//
// One deliberate difference: the trip planner prices every pair of stops
// with Mapbox's drive-time matrix. Here the cost is straight-line distance
// (converted to a rough drive time with a detour penalty) because it is
// free and instant, and this app has always avoided paid distance-matrix
// calls for ordering. The route line and per-leg times still use real
// roads (see computeRoadRoute in mapRouteHelpers.js).
import { haversineMiles } from './salesRoutes';

const AVG_MPH = 45;
const DETOUR_FACTOR = 1.5;
const EXACT_LIMIT = 12;

function hasCoords(s) {
  return s.property_lat != null && s.property_lng != null;
}
function ll(s) {
  return { lat: s.property_lat, lng: s.property_lng };
}

/** Stable key for a list of points; used to tell whether a drawn route is stale. */
export function pointsKey(points) {
  return points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
}

function costMatrix(points) {
  return points.map((a, i) => points.map((b, j) => {
    if (i === j) return 0;
    const d = haversineMiles(a, b);
    return d == null ? Infinity : (d / AVG_MPH) * 3600 * DETOUR_FACTOR;
  }));
}

/**
 * Best open path that starts at node 0 and visits every other node once,
 * ending wherever is cheapest. cost[i][j] is the cost of going i -> j.
 * Returns node indices (excluding node 0) in visiting order.
 */
export function solveOpenPath(cost) {
  const n = cost.length - 1;
  if (n <= 0) return [];
  if (n === 1) return [1];
  return n <= EXACT_LIMIT ? heldKarp(cost, n) : heuristicPath(cost, n);
}

function heldKarp(cost, n) {
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = cost[0][j + 1];
  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const cur = dp[mask * n + last];
      if (cur === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const v = cur + cost[last + 1][next + 1];
        if (v < dp[nm * n + next]) { dp[nm * n + next] = v; parent[nm * n + next] = last; }
      }
    }
  }
  const full = size - 1;
  let bestLast = 0;
  let best = Infinity;
  for (let j = 0; j < n; j++) {
    if (dp[full * n + j] < best) { best = dp[full * n + j]; bestLast = j; }
  }
  const order = [];
  let mask = full;
  let last = bestLast;
  while (last !== -1) {
    order.push(last + 1);
    const p = parent[mask * n + last];
    mask &= ~(1 << last);
    last = p;
  }
  return order.reverse();
}

function pathCost(cost, path) {
  let total = 0;
  let prev = 0;
  for (const node of path) { total += cost[prev][node]; prev = node; }
  return total;
}

function heuristicPath(cost, n) {
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  let path = [];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bd = Infinity;
    for (const c of left) if (cost[cur][c] < bd) { bd = cost[cur][c]; best = c; }
    if (best === -1) best = left.values().next().value;
    path.push(best);
    left.delete(best);
    cur = best;
  }
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    let base = pathCost(cost, path);
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        const c = pathCost(cost, cand);
        if (c < base - 1e-9) { path = cand; base = c; improved = true; }
      }
    }
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      const rest = [...path.slice(0, i), ...path.slice(i + 1)];
      for (let k = 0; k <= rest.length; k++) {
        if (k === i) continue;
        const cand = [...rest.slice(0, k), node, ...rest.slice(k)];
        const c = pathCost(cost, cand);
        if (c < base - 1e-9) { path = cand; base = c; improved = true; }
      }
    }
  }
  return path;
}

/**
 * Most efficient visiting order for `stops`, leaving from `anchor` ({lat,lng}).
 * With no anchor the first stop stays first and acts as the origin. The route
 * ends at whichever stop makes the whole drive shortest. Stops without
 * coordinates can't be placed by distance and are appended in their original order.
 */
export function orderStops(anchor, stops) {
  const placed = stops.filter(hasCoords);
  const unplaced = stops.filter(s => !hasCoords(s));
  const first = anchor ? null : placed[0];
  const movable = anchor ? placed : placed.slice(1);
  if ((!anchor && !first) || movable.length < 2) return [...stops];
  const points = [anchor || ll(first), ...movable.map(ll)];
  const order = solveOpenPath(costMatrix(points));
  const ordered = order.map(i => movable[i - 1]);
  return [...(first ? [first] : []), ...ordered, ...unplaced];
}

/**
 * Index in `stops` where a new stop adds the least driving without
 * disturbing the existing order. With no anchor the first stop is the
 * origin and stays first.
 */
export function cheapestInsertionIndex(anchor, stops, stop) {
  if (!hasCoords(stop)) return stops.length;
  const firstSlot = anchor ? 0 : 1;
  if (stops.length < firstSlot) return stops.length;
  const here = ll(stop);
  let bestSlot = stops.length;
  let bestAdd = Infinity;
  for (let slot = firstSlot; slot <= stops.length; slot++) {
    const prev = slot === 0 ? anchor : (hasCoords(stops[slot - 1]) ? ll(stops[slot - 1]) : null);
    const next = stops[slot] && hasCoords(stops[slot]) ? ll(stops[slot]) : null;
    if (!prev) continue;
    const add = next
      ? haversineMiles(prev, here) + haversineMiles(here, next) - haversineMiles(prev, next)
      : haversineMiles(prev, here);
    if (add < bestAdd) { bestAdd = add; bestSlot = slot; }
  }
  return bestSlot;
}
