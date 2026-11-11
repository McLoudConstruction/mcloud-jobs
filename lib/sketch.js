// Sketch data model and geometry. Pure functions only (no DOM), so they can be tested.
//
// A sketch is one JSON document, measured in feet (version 2):
//   { v: 2,
//     rooms: [{ id, label, notes, pts: [[x, y], ...] }],             a room is a closed shape: its corner points in order
//     water: [{ id, cat: 1|2|3, smooth: bool, pts: [[x, y], ...] }], where water went (cat = clean / gray / black water)
//     marks: [{ id, type: 'pen', color, pts } | { id, type: 'text', x, y, text, color }] }
// Version 1 sketches stored each room as a rectangle { x, y, w, h }; normalizePlan converts those on load,
// so nothing already drawn is lost. A wall is the line between two neighbouring points of a room.
// Later layers (moisture points, equipment) can be added beside rooms, water and marks without a migration.

export const SKETCH_VERSION = 2;
export const SNAP = 0.5; // feet
export const MIN_ROOM = 1;
export const MAX_ROOM = 500;
export const MAX_ROOMS = 80;
export const MAX_ROOM_PTS = 80;
export const MAX_WATER = 60;
export const MAX_WATER_PTS = 200;
export const MAX_MARKS = 400;
export const MAX_POINTS = 2000;
const COORD = 5000;

export const ROOM_PRESETS = [
  'Kitchen', 'Living room', 'Dining room', 'Bedroom', 'Bathroom', 'Hallway',
  'Laundry', 'Basement', 'Garage', 'Office', 'Closet', 'Entry',
];
export const MARK_COLORS = ['#2f4858', '#c0392b', '#2d7ff9', '#3a6b45', '#b9770e'];
// Water categories (the standard restoration ones): 1 clean, 2 gray, 3 black
export const WATER_CATS = { 1: 'Category 1 (clean)', 2: 'Category 2 (gray)', 3: 'Category 3 (black)' };

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const EPS = 1e-6;

export function makeId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export const emptyPlan = () => ({ v: SKETCH_VERSION, rooms: [], water: [], marks: [] });

export const snap = (v, step = SNAP) => round2(Math.round(v / step) * step);

// ------------------------------------------------------------------ points
const cleanPt = (p) => [round2(clamp(Number(p[0]), -COORD, COORD)), round2(clamp(Number(p[1]), -COORD, COORD))];
const goodPt = (p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));

export const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polyBox(pts) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
}

export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const edgeLenOf = (pts, i) => {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};
export const edgeLength = edgeLenOf;

// ------------------------------------------------------------------- rooms
export function newRoom(label, x, y, w = 10, h = 10) {
  const sw = clamp(snap(w), MIN_ROOM, MAX_ROOM);
  const sh = clamp(snap(h), MIN_ROOM, MAX_ROOM);
  return { id: makeId(), label: String(label || '').slice(0, 40), notes: '', pts: rectPts(snap(x), snap(y), sw, sh) };
}

export const roomBox = (r) => polyBox(r.pts);

// A plain rectangle with straight, level walls (the common case: it keeps the width and length boxes).
export function isRect(r) {
  const p = r.pts;
  if (p.length !== 4) return false;
  const h1 = Math.abs(p[0][1] - p[1][1]) < EPS && Math.abs(p[1][0] - p[2][0]) < EPS && Math.abs(p[2][1] - p[3][1]) < EPS && Math.abs(p[3][0] - p[0][0]) < EPS;
  const h2 = Math.abs(p[0][0] - p[1][0]) < EPS && Math.abs(p[1][1] - p[2][1]) < EPS && Math.abs(p[2][0] - p[3][0]) < EPS && Math.abs(p[3][1] - p[0][1]) < EPS;
  return h1 || h2;
}

export const roomArea = (r) => polyArea(r.pts);
export const totalArea = (plan) => Math.round((plan?.rooms || []).reduce((s, r) => s + roomArea(r), 0));

// Reads whatever came out of the database and returns a plan the editor can trust.
export function normalizePlan(raw) {
  const plan = emptyPlan();
  if (!raw || typeof raw !== 'object') return plan;
  const seen = new Set();
  const uid = (id) => {
    let s = typeof id === 'string' && id && id.length <= 40 ? id : makeId();
    while (seen.has(s)) s = makeId();
    seen.add(s);
    return s;
  };
  for (const r of (Array.isArray(raw.rooms) ? raw.rooms : []).slice(0, MAX_ROOMS)) {
    if (!r || typeof r !== 'object') continue;
    let pts;
    if (Array.isArray(r.pts)) {
      pts = r.pts.slice(0, MAX_ROOM_PTS).filter(goodPt).map(cleanPt);
      if (pts.length < 3) continue;
    } else { // version 1: a rectangle
      const x = round2(clamp(num(r.x), -COORD, COORD));
      const y = round2(clamp(num(r.y), -COORD, COORD));
      pts = rectPts(x, y, round2(clamp(num(r.w, 10), MIN_ROOM, MAX_ROOM)), round2(clamp(num(r.h, 10), MIN_ROOM, MAX_ROOM)));
    }
    plan.rooms.push({ id: uid(r.id), label: String(r.label ?? '').slice(0, 40), notes: String(r.notes ?? '').slice(0, 300), pts });
  }
  for (const w of (Array.isArray(raw.water) ? raw.water : []).slice(0, MAX_WATER)) {
    if (!w || typeof w !== 'object' || !Array.isArray(w.pts)) continue;
    const pts = w.pts.slice(0, MAX_WATER_PTS).filter(goodPt).map(cleanPt);
    if (pts.length < 3) continue;
    plan.water.push({ id: uid(w.id), cat: [1, 2, 3].includes(Number(w.cat)) ? Number(w.cat) : 1, smooth: !!w.smooth, pts });
  }
  for (const m of (Array.isArray(raw.marks) ? raw.marks : []).slice(0, MAX_MARKS)) {
    if (!m || typeof m !== 'object') continue;
    const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : MARK_COLORS[0];
    if (m.type === 'pen' && Array.isArray(m.pts)) {
      const pts = m.pts.slice(0, MAX_POINTS).filter(goodPt).map(cleanPt);
      if (pts.length) plan.marks.push({ id: uid(m.id), type: 'pen', color, pts });
    } else if (m.type === 'text' && String(m.text ?? '').trim()) {
      plan.marks.push({
        id: uid(m.id), type: 'text', color,
        x: round2(clamp(num(m.x), -COORD, COORD)), y: round2(clamp(num(m.y), -COORD, COORD)),
        text: String(m.text).slice(0, 60),
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------- measuring
// 12.5 -> 12' 6"   12 -> 12'   (nearest inch)
export function fmtFeet(v) {
  const totalIn = Math.round(Number(v) * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

// Width x length for a plain rectangle; other shapes show their overall size.
export function roomSizeText(r) {
  const b = roomBox(r);
  return `${isRect(r) ? '' : '~'}${fmtFeet(b.w)} × ${fmtFeet(b.h)}`;
}

export const roomAreaText = (r) => `${Math.round(roomArea(r))} sq ft`;

// Accepts 12, 12.5, 12', 12'6, 12' 6", 12ft, 12 ft 6 in. Returns NaN when it cannot read it.
export function parseFeet(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return round2(Number(s));
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/);
  if (!m) return NaN;
  return round2(Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0));
}

// -------------------------------------------------------------- hit testing
export const inRoom = (r, x, y) => pointInPoly(r.pts, x, y);

// The room on top at a point (later rooms draw over earlier ones).
export function hitRoom(plan, x, y) {
  for (let i = plan.rooms.length - 1; i >= 0; i -= 1) if (inRoom(plan.rooms[i], x, y)) return plan.rooms[i];
  return null;
}

// The corner of a room nearest a point, within tol feet: its index, or -1. Of two corners in the same
// spot (a wall break), the later one wins.
export function nearestVertex(room, x, y, tol) {
  let best = -1;
  let bestD = tol;
  room.pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= bestD + EPS) { best = i; bestD = d; }
  });
  return best;
}

// The wall nearest a point, within tol feet: { i, x, y, dist } (i is the wall from point i to point i+1;
// x, y the closest spot on it) or null. Walls of no length are skipped.
export function nearestEdge(room, x, y, tol) {
  let best = null;
  const n = room.pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = room.pts[i];
    const b = room.pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) continue;
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / len2, 0, 1);
    const qx = a[0] + t * dx;
    const qy = a[1] + t * dy;
    const dist = Math.hypot(x - qx, y - qy);
    if (dist <= tol && (!best || dist < best.dist)) best = { i, x: qx, y: qy, dist };
  }
  return best;
}

// Across every room: the wall or corner closest to a point, so a new room can start on it.
export function nearestAnchor(plan, x, y, tol, skipId = null) {
  let best = null;
  for (const r of plan.rooms) {
    if (r.id === skipId) continue;
    const v = nearestVertex(r, x, y, tol);
    if (v >= 0) {
      const d = Math.hypot(r.pts[v][0] - x, r.pts[v][1] - y);
      if (!best || d < best.dist) best = { x: r.pts[v][0], y: r.pts[v][1], dist: d, roomId: r.id };
    }
  }
  if (best) return best;
  for (const r of plan.rooms) {
    if (r.id === skipId) continue;
    const e = nearestEdge(r, x, y, tol);
    if (e && (!best || e.dist < best.dist)) { const q = snapOnEdge(r.pts, e.i, e.x, e.y); best = { x: q.x, y: q.y, dist: e.dist, roomId: r.id }; }
  }
  return best;
}

export function markHit(m, x, y, tol) {
  if (m.type === 'pen') {
    if (m.pts.length === 1) return Math.hypot(x - m.pts[0][0], y - m.pts[0][1]) <= tol;
    for (let i = 1; i < m.pts.length; i += 1) {
      if (distToSegment(x, y, m.pts[i - 1][0], m.pts[i - 1][1], m.pts[i][0], m.pts[i][1]) <= tol) return true;
    }
    return false;
  }
  // text: a box starting at its point, about 0.8 ft per character wide (editor draws it to match)
  const w = Math.max(1.5, m.text.length * 0.8);
  return x >= m.x - tol && x <= m.x + w + tol && y >= m.y - 1.6 - tol && y <= m.y + tol;
}

export function hitMarkAt(plan, x, y, tol) {
  for (let i = plan.marks.length - 1; i >= 0; i -= 1) if (markHit(plan.marks[i], x, y, tol)) return plan.marks[i];
  return null;
}

// The water area on top at a point.
export function hitWater(plan, x, y) {
  for (let i = plan.water.length - 1; i >= 0; i -= 1) if (pointInPoly(waterOutline(plan.water[i]), x, y)) return plan.water[i];
  return null;
}

// Drops points closer together than minDist, always keeping the first and last.
export function simplifyStroke(pts, minDist) {
  if (pts.length <= 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ----------------------------------------------------------- editing walls
const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

export const translatePts = (pts, dx, dy) => pts.map((p) => [round2(p[0] + dx), round2(p[1] + dy)]);

// A spot on wall i, snapped: on the grid for level or plumb walls, in half-foot steps along an angled one,
// and kept off the very ends.
export function snapOnEdge(pts, i, x, y) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < EPS) return { x: a[0], y: a[1] };
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  let s = clamp((x - a[0]) * ux + (y - a[1]) * uy, 0, len);
  if (Math.abs(a[1] - b[1]) < EPS) { // level
    const nx = clamp(snap(x), Math.min(a[0], b[0]), Math.max(a[0], b[0]));
    return { x: round2(nx), y: a[1] };
  }
  if (Math.abs(a[0] - b[0]) < EPS) { // plumb
    const ny = clamp(snap(y), Math.min(a[1], b[1]), Math.max(a[1], b[1]));
    return { x: a[0], y: round2(ny) };
  }
  s = clamp(snap(s), 0, len);
  return { x: round2(a[0] + ux * s), y: round2(a[1] + uy * s) };
}

// A wall break: wall i is cut at a spot into two walls that can then be moved on their own (the cut is two
// points in the same place). Break a wall twice and the piece between is a bump or an inset.
export function insertBreak(room, i, x, y) {
  if (room.pts.length + 2 > MAX_ROOM_PTS || edgeLenOf(room.pts, i) < 1) return room;
  const q = snapOnEdge(room.pts, i, x, y);
  const pts = [...room.pts.slice(0, i + 1), [q.x, q.y], [q.x, q.y], ...room.pts.slice(i + 1)];
  return { ...room, pts };
}

// A single new corner on wall i, so the wall can be bent into an angle.
export function insertCorner(room, i, x, y) {
  if (room.pts.length + 1 > MAX_ROOM_PTS || edgeLenOf(room.pts, i) < 1) return room;
  const q = snapOnEdge(room.pts, i, x, y);
  const pts = [...room.pts.slice(0, i + 1), [q.x, q.y], ...room.pts.slice(i + 1)];
  return { ...room, pts };
}

export function removeVertex(room, i) {
  if (room.pts.length <= 3) return room;
  return { ...room, pts: room.pts.filter((_, k) => k !== i) };
}

// Merges repeated points and straightens out corners that are not really corners.
export function tidyPts(pts) {
  let out = pts.filter((p, i) => !same(p, pts[(i + pts.length - 1) % pts.length]));
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i += 1) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-4) { out = out.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return out.length >= 3 ? out : pts;
}

// After an edit: drops the points among the given indices (and only those) that now sit dead straight between
// their neighbours, so cutting a corner does not leave a stray point in the middle of the diagonal. A point that
// shares its spot with another (a wall break) or that doubles back on itself is never dropped, and a room keeps
// at least three points.
export function dropStraightPoints(pts, indices) {
  const n0 = pts.length;
  const refs = [...new Set(indices.map((k) => ((k % n0) + n0) % n0))].map((k) => pts[k]);
  let out = pts;
  for (const ref of refs) {
    const i = out.indexOf(ref);
    if (i < 0 || out.length <= 3) continue;
    const a = out[(i + out.length - 1) % out.length];
    const c = out[(i + 1) % out.length];
    const ux = ref[0] - a[0]; const uy = ref[1] - a[1];
    const vx = c[0] - ref[0]; const vy = c[1] - ref[1];
    const lu = Math.hypot(ux, uy); const lv = Math.hypot(vx, vy);
    if (lu < EPS || lv < EPS) continue; // a wall break: keep it
    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    if (Math.abs(cross) < 1e-4 * lu * lv && dot > 0) out = out.filter((_, k) => k !== i);
  }
  return out;
}

// Moves corner i to (x, y). Unless free, the walls on either side of it that were level or plumb stay level
// or plumb, so dragging a corner of a rectangle resizes it and an L-shape keeps its square corners.
export function moveVertex(pts, i, x, y, { free = false } = {}) {
  const n = pts.length;
  const out = pts.map((p) => [p[0], p[1]]);
  const old = pts[i];
  out[i] = [round2(x), round2(y)];
  if (free) return out;
  for (const k of [(i + n - 1) % n, (i + 1) % n]) {
    if (k === i) continue;
    const o = pts[k];
    const dx = Math.abs(o[0] - old[0]);
    const dy = Math.abs(o[1] - old[1]);
    if (dx < EPS && dy < EPS) continue; // a break: no wall between them to keep square
    if (dy < EPS) out[k] = [o[0], round2(y)];       // was level: stays level
    else if (dx < EPS) out[k] = [round2(x), o[1]];  // was plumb: stays plumb
  }
  return out;
}

// Slides wall i sideways by (mx, my) while the walls on either side of it keep their direction: each end of the
// wall slides along its neighbour (to where the moved wall meets the neighbour's line) instead of dragging the
// neighbour with it. A wall break (two points in one spot) is looked through: the real wall behind it is the
// neighbour, and the break's other point goes with the end. If that wall is parallel to the moved one (a bump or
// an inset) there is nothing to slide along, so the end is simply carried over by (mx, my) and the break stays.
// The slide stops before a neighbour shrinks to nothing.
function slideEdge(pts, i, mx, my) {
  const n = pts.length;
  const j = (i + 1) % n;
  const a = pts[i];
  const b = pts[j];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const elen = Math.hypot(ex, ey);
  const reach = (k, step, other) => { // the end's neighbour: its far point, and the break points stuck to the end
    const mates = [];
    let c = k;
    for (let t = 0; t < n; t += 1) {
      const q = (c + step + n) % n;
      if (q === other || q === k) return { k, far: null, mates };
      if (same(pts[q], pts[k])) { mates.push(q); c = q; continue; }
      return { k, far: pts[q], mates };
    }
    return { k, far: null, mates };
  };
  const ends = [reach(i, -1, j), reach(j, 1, i)];
  const MIN_T = 0.02; // a neighbour keeps at least this share of its length
  // Where an end lands for a sideways move of scale f (the move is (mx, my) * f), and how far along its
  // neighbour (1 = where it was, 0 = at the neighbour's far end); null when it just follows the move.
  const land = (e, f) => {
    if (!e.far) return null;
    const o = pts[e.k];
    const dx = o[0] - e.far[0];
    const dy = o[1] - e.far[1];
    const cross = dx * ey - dy * ex; // neighbour direction x wall direction
    if (Math.abs(cross) < 1e-6 * Math.hypot(dx, dy) * elen) return null;
    // the moved wall's line: a + (mx, my) * f + u * (ex, ey); the neighbour's line: far + t * (dx, dy)
    const rx = a[0] + mx * f - e.far[0];
    const ry = a[1] + my * f - e.far[1];
    const t = (rx * ey - ry * ex) / cross;
    return { t, x: e.far[0] + t * dx, y: e.far[1] + t * dy };
  };
  let f = 1;
  for (const e of ends) { // t is linear in f, so cap f where a neighbour would shrink below MIN_T
    const at1 = land(e, 1);
    const at0 = land(e, 0);
    if (!at1 || !at0 || at1.t >= MIN_T) continue;
    const slope = at1.t - at0.t;
    if (slope < -EPS) f = Math.min(f, Math.max(0, (MIN_T - at0.t) / slope));
  }
  const out = pts.map((p) => [p[0], p[1]]);
  for (const e of ends) {
    const q = land(e, f);
    if (q) {
      out[e.k] = [round2(q.x), round2(q.y)];
      for (const m of e.mates) out[m] = [round2(q.x), round2(q.y)];
    } else {
      out[e.k] = [round2(pts[e.k][0] + mx * f), round2(pts[e.k][1] + my * f)];
    }
  }
  return out;
}

// Pushes wall i sideways by (dx, dy). Unless free, the move is only across the wall (a level wall moves up or
// down) and the neighbouring walls keep their direction: the wall's ends slide along them, so they get longer
// or shorter but never tilt. With free, the wall's two end points are just carried by (dx, dy).
export function moveEdge(pts, i, dx, dy, { free = false } = {}) {
  const n = pts.length;
  const j = (i + 1) % n;
  const a = pts[i];
  const b = pts[j];
  if (free) return pts.map((p, k) => (k === i || k === j ? [round2(p[0] + dx), round2(p[1] + dy)] : [p[0], p[1]]));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < EPS) return pts.map((p) => [p[0], p[1]]);
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const d = dx * nx + dy * ny;
  return slideEdge(pts, i, nx * d, ny * d);
}

// moveEdge with the result landing on the grid: a level wall moves to a grid line, a plumb one likewise, and an
// angled one moves in half-foot steps across itself. Neighbouring walls keep their direction (see moveEdge).
export function moveEdgeSnapped(pts, i, dx, dy, { free = false } = {}) {
  const j = (i + 1) % pts.length;
  const a = pts[i];
  const b = pts[j];
  if (free) return moveEdge(pts, i, snap(a[0] + dx) - a[0], snap(a[1] + dy) - a[1], { free: true });
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < EPS) return pts.map((p) => [p[0], p[1]]);
  if (Math.abs(a[1] - b[1]) < EPS) return slideEdge(pts, i, 0, snap(a[1] + dy) - a[1]);
  if (Math.abs(a[0] - b[0]) < EPS) return slideEdge(pts, i, snap(a[0] + dx) - a[0], 0);
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const d0 = dx * nx + dy * ny;
  // Prefer a move that lands an end exactly on a grid line of the wall it slides along (when that wall is level
  // or plumb), so the lengths stay tidy; otherwise move in snapped steps across the wall.
  let d = snap(d0);
  let best = Infinity;
  const here = slideEdge(pts, i, nx * d0, ny * d0);
  const step = slideEdge(pts, i, nx * (d0 + 1), ny * (d0 + 1));
  for (const k of [i, j]) {
    const vx = step[k][0] - here[k][0];
    const vy = step[k][1] - here[k][1];
    let c = -1;
    if (Math.abs(vy) < 1e-6 && Math.abs(vx) > 1e-6) c = 0; // slides along a level wall: x changes
    else if (Math.abs(vx) < 1e-6 && Math.abs(vy) > 1e-6) c = 1; // along a plumb wall: y changes
    if (c < 0) continue;
    const dd = (snap(here[k][c]) - here[k][c]) / (c === 0 ? vx : vy);
    if (Math.abs(dd) <= SNAP && Math.abs(dd) < best) { best = Math.abs(dd); d = d0 + dd; }
  }
  return slideEdge(pts, i, nx * d, ny * d);
}

// Sets how long wall i is by moving its far end along the wall (with the same squareness rule as moveVertex).
export function setEdgeLength(pts, i, len) {
  const n = pts.length;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const cur = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (cur < EPS || !(len > 0)) return pts;
  const k = len / cur;
  return moveVertex(pts, (i + 1) % n, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
}

// Resizes a rectangle room to a width and length, keeping its top-left corner.
export function resizeRect(room, w, h) {
  const b = roomBox(room);
  return { ...room, pts: rectPts(b.x, b.y, clamp(w, MIN_ROOM, MAX_ROOM), clamp(h, MIN_ROOM, MAX_ROOM)) };
}

// Where to put a room's name: the spot inside the room farthest from its walls.
const labelCache = new WeakMap();
export function labelPoint(room) {
  const cached = labelCache.get(room.pts);
  if (cached) return cached;
  const b = polyBox(room.pts);
  let best = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let bestD = -1;
  const N = 14;
  for (let a = 0; a <= N; a += 1) {
    for (let c = 0; c <= N; c += 1) {
      const x = b.x + (b.w * (a + 0.5)) / (N + 1);
      const y = b.y + (b.h * (c + 0.5)) / (N + 1);
      if (!pointInPoly(room.pts, x, y)) continue;
      let d = Infinity;
      for (let i = 0; i < room.pts.length; i += 1) {
        const p = room.pts[i]; const q = room.pts[(i + 1) % room.pts.length];
        d = Math.min(d, distToSegment(x, y, p[0], p[1], q[0], q[1]));
      }
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  labelCache.set(room.pts, best);
  return best;
}

// -------------------------------------------------------------- water areas
// Ramer-Douglas-Peucker: keeps the few points that carry the shape of a line and drops the wobble between them.
export function simplifyRDP(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = simplifyRDP(pts.slice(0, idx + 1), eps);
  const right = simplifyRDP(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

// Turns a hand-drawn loop into a clean closed shape.
//   mode 'smooth'   keeps the wandering outline (jutting out here, back in there) with the wobble removed
//   mode 'straight' also snaps points to the grid and makes nearly level or plumb walls level or plumb
// eps is how much wobble to ignore, in feet. Returns the corner points, or null when the drawing is too small.
export function cleanWater(stroke, { mode = 'smooth', eps = 0.4, minArea = 2 } = {}) {
  let pts = stroke.filter(goodPt).map((p) => [Number(p[0]), Number(p[1])]);
  if (pts.length < 3) return null;
  // the loop is closed by joining the last point back to the first
  pts = simplifyRDP(pts, mode === 'straight' ? eps : eps * 0.8);
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < eps * 2) pts.pop();
  if (pts.length < 3) return null;
  if (mode === 'straight') {
    pts = pts.map((p) => [snap(p[0]), snap(p[1])]);
    const n = pts.length;
    const lim = Math.tan((14 * Math.PI) / 180);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = pts[i];
        const j = (i + 1) % n;
        const b = pts[j];
        const dx = Math.abs(b[0] - a[0]);
        const dy = Math.abs(b[1] - a[1]);
        if (dx < EPS && dy < EPS) continue;
        if (dy <= dx * lim) pts[j] = [b[0], a[1]];
        else if (dx <= dy * lim) pts[j] = [a[0], b[1]];
      }
    }
    pts = tidyPts(pts);
  }
  pts = pts.map(cleanPt).slice(0, MAX_WATER_PTS);
  if (pts.length < 3 || polyArea(pts) < minArea) return null;
  return pts;
}

export function newWater(pts, cat = 1, smooth = true) {
  return { id: makeId(), cat, smooth, pts };
}

// The outline that is drawn and measured: the corner points, or for a smooth shape the rounded curve through them.
export function waterOutline(w) {
  if (!w.smooth || w.pts.length < 3) return w.pts;
  const n = w.pts.length;
  const out = [];
  const STEPS = 8;
  for (let i = 0; i < n; i += 1) {
    const p0 = w.pts[(i + n - 1) % n];
    const p1 = w.pts[i];
    const p2 = w.pts[(i + 1) % n];
    const sx = (p0[0] + p1[0]) / 2; const sy = (p0[1] + p1[1]) / 2;
    const ex = (p1[0] + p2[0]) / 2; const ey = (p1[1] + p2[1]) / 2;
    for (let s = 0; s < STEPS; s += 1) {
      const t = s / STEPS;
      const u = 1 - t;
      out.push([u * u * sx + 2 * u * t * p1[0] + t * t * ex, u * u * sy + 2 * u * t * p1[1] + t * t * ey]);
    }
  }
  return out;
}

// How much of each room is wet: { roomId: { wet (sq ft), cat (worst category there) } }. Measured by checking
// points across the room, so it is an estimate, good to about a percent. Overlapping water counts once.
export function wetAreas(plan) {
  const out = {};
  if (!plan.water?.length || !plan.rooms?.length) return out;
  const shapes = plan.water.map((w) => ({ cat: w.cat, pts: waterOutline(w), box: polyBox(waterOutline(w)) }));
  for (const r of plan.rooms) {
    const rb = roomBox(r);
    const hits = shapes.filter((s) => s.box.minX <= rb.maxX && s.box.maxX >= rb.minX && s.box.minY <= rb.maxY && s.box.maxY >= rb.minY);
    if (!hits.length) continue;
    let step = 0.25;
    while ((rb.w / step) * (rb.h / step) > 40000) step *= 2;
    let count = 0;
    let cat = 0;
    for (let x = rb.minX + step / 2; x < rb.maxX; x += step) {
      for (let y = rb.minY + step / 2; y < rb.maxY; y += step) {
        let c = 0;
        for (const s of hits) if (s.cat > c && pointInPoly(s.pts, x, y)) c = s.cat;
        if (c && pointInPoly(r.pts, x, y)) { count += 1; cat = Math.max(cat, c); }
      }
    }
    if (count) out[r.id] = { wet: Math.round(count * step * step), cat };
  }
  return out;
}

export const totalWet = (wet) => Object.values(wet || {}).reduce((s, v) => s + v.wet, 0);

// ------------------------------------------------------------------- view
export function planBounds(plan) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const r of plan.rooms) r.pts.forEach((p) => add(p[0], p[1]));
  for (const w of plan.water || []) w.pts.forEach((p) => add(p[0], p[1]));
  for (const m of plan.marks) {
    if (m.type === 'pen') m.pts.forEach((p) => add(p[0], p[1]));
    else { add(m.x, m.y - 1.6); add(m.x + Math.max(1.5, m.text.length * 0.8), m.y); }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// Scale (pixels per foot) and offset that fit the drawing in a box, centred. Empty plan: a 30 x 20 ft view.
export function fitView(bounds, width, height, pad = 24) {
  const b = bounds || { minX: 0, minY: 0, maxX: 30, maxY: 20 };
  const bw = Math.max(b.maxX - b.minX, 4);
  const bh = Math.max(b.maxY - b.minY, 4);
  const scale = clamp(Math.min((width - pad * 2) / bw, (height - pad * 2) / bh), 4, 80);
  return {
    scale,
    ox: (width - bw * scale) / 2 - b.minX * scale,
    oy: (height - bh * scale) / 2 - b.minY * scale,
  };
}

export const toWorld = (view, sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });
export const toScreen = (view, x, y) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy });

// -------------------------------------------------------------- photo counts
// How many (non-archived) photos are attached to each room of a sketch.
export function roomPhotoCounts(photos, sketchId) {
  const out = {};
  for (const p of photos || []) {
    if (p.archived_at || p.sketch_id !== sketchId || !p.room_key) continue;
    out[p.room_key] = (out[p.room_key] || 0) + 1;
  }
  return out;
}

// ---- carving: a new room drawn over an existing one takes that space away from it ----

function clipHalf(pts, axis, val, keepLess) {
  const inside = (p) => (keepLess ? p[axis] <= val + 1e-9 : p[axis] >= val - 1e-9);
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ia = inside(a); const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (val - a[axis]) / (b[axis] - a[axis]);
      out.push([round2(a[0] + (b[0] - a[0]) * t), round2(a[1] + (b[1] - a[1]) * t)]);
    }
  }
  return out;
}

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

// Joins polygons that only touch along shared walls: edges that are walked in both directions cancel,
// and the edges left over are traced back into outlines. Returns the outlines, biggest first.
export function unionTouching(pieces) {
  const polys = pieces.map((p) => (signedArea(p) < 0 ? [...p].reverse() : p)).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 0.01);
  const verts = polys.flat();
  const key = (p) => `${p[0]},${p[1]}`;
  const edges = new Map();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const on = verts.filter((v) => key(v) !== key(a) && key(v) !== key(b) && distToSegment(v[0], v[1], a[0], a[1], b[0], b[1]) < 1e-6);
      on.sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]));
      const chain = [a, ...on, b];
      for (let k = 0; k < chain.length - 1; k += 1) {
        const p = chain[k]; const q = chain[k + 1];
        if (key(p) === key(q)) continue;
        const rev = `${key(q)}>${key(p)}`;
        if (edges.has(rev)) edges.delete(rev); else edges.set(`${key(p)}>${key(q)}`, [p, q]);
      }
    }
  }
  const from = new Map();
  for (const [p, q] of edges.values()) { if (!from.has(key(p))) from.set(key(p), []); from.get(key(p)).push([p, q]); }
  const loops = [];
  const used = new Set();
  for (const [p0, q0] of edges.values()) {
    const k0 = `${key(p0)}>${key(q0)}`;
    if (used.has(k0)) continue;
    const loop = [];
    let cur = [p0, q0];
    let guard = 0;
    while (cur && !used.has(`${key(cur[0])}>${key(cur[1])}`) && guard < 1000) {
      used.add(`${key(cur[0])}>${key(cur[1])}`);
      loop.push(cur[0]);
      cur = (from.get(key(cur[1])) || []).find(([a, b]) => !used.has(`${key(a)}>${key(b)}`));
      guard += 1;
    }
    if (loop.length >= 3 && signedArea(loop) > 0.01) loops.push(tidyPts(loop));
  }
  return loops.sort((a, b) => polyArea(b) - polyArea(a));
}

// What is left of a room's outline once the rectangle {x, y, w, h} is cut out of it:
// the room unchanged (nothing overlapped), a list of outlines (one, or several if it was cut in two),
// or [] when the rectangle covers the room completely.
export function subtractRect(pts, rect) {
  const x0 = rect.x; const x1 = rect.x + rect.w; const y0 = rect.y; const y1 = rect.y + rect.h;
  const box = polyBox(pts);
  if (box.maxX <= x0 + 1e-9 || box.minX >= x1 - 1e-9 || box.maxY <= y0 + 1e-9 || box.minY >= y1 - 1e-9) return [pts];
  const mid = clipHalf(clipHalf(pts, 0, x0, false), 0, x1, true);
  const pieces = [
    clipHalf(pts, 0, x0, true),
    clipHalf(pts, 0, x1, false),
    clipHalf(mid, 1, y0, true),
    clipHalf(mid, 1, y1, false),
  ].filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 0.01);
  const kept = pieces.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
  if (kept >= polyArea(pts) - 0.01) return [pts]; // only touching along a wall
  if (!pieces.length) return [];
  const loops = unionTouching(pieces);
  return loops.length ? loops : [pts];
}

// Cuts {x, y, w, h} out of every room. A room that is split in two becomes two rooms (the bigger part keeps
// the name and notes); a room that is covered completely is removed. A rectangle drawn wholly inside a
// room leaves that room alone, since a room can't have a hole.
export function carveRooms(rooms, rect) {
  const out = [];
  for (const r of rooms) {
    const res = subtractRect(r.pts, rect);
    const left = res.reduce((s, p) => s + polyArea(p), 0);
    // untouched, or the rectangle sits wholly inside (a hole): keep the room as it was
    if ((res.length === 1 && res[0] === r.pts) || left >= polyArea(r.pts) - 0.01) { out.push(r); continue; }
    res.forEach((pts, i) => {
      out.push(i === 0 ? { ...r, pts } : { id: makeId(), label: '', notes: '', pts });
    });
  }
  return out;
}
