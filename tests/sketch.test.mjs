import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPlan, normalizePlan, newRoom, snap, parseFeet, fmtFeet, roomArea, totalArea, hitRoom,
  hitMarkAt, simplifyStroke, planBounds, fitView, toWorld, toScreen, roomPhotoCounts, distToSegment,
  rectPts, polyArea, isRect, roomBox, nearestVertex, nearestEdge, nearestAnchor, insertBreak, insertCorner, addCornerCut,
  removeVertex, dropStraightPoints, tidyPts, moveVertex, moveEdge, moveEdgeSnapped, setEdgeLength, resizeRect, simplifyRDP, cleanWater, waterOutline,
  carveRooms, subtractRect, wetAreas, totalWet, hitWater, newWater, labelPoint,
  MAX_ROOMS, MAX_ROOM, MIN_ROOM,
} from '../lib/sketch.js';
import { drawPlan } from '../lib/sketchDraw.js';

test('snapping goes to the nearest half foot without float noise', () => {
  assert.equal(snap(3.26), 3.5);
  assert.equal(snap(3.24), 3);
  assert.equal(snap(-0.3), -0.5);
  assert.equal(snap(0.1 + 0.2), 0.5);
});

test('parseFeet reads feet, decimals and feet-and-inches; rejects nonsense', () => {
  assert.equal(parseFeet('12'), 12);
  assert.equal(parseFeet(' 12.5 '), 12.5);
  assert.equal(parseFeet("12'"), 12);
  assert.equal(parseFeet("12'6"), 12.5);
  assert.equal(parseFeet('12\' 6"'), 12.5);
  assert.equal(parseFeet('12 ft 3 in'), 12.25);
  assert.equal(parseFeet('10ft'), 10);
  for (const bad of ['', 'abc', '12x', "-5", '1,5', null, undefined]) assert.ok(Number.isNaN(parseFeet(bad)), String(bad));
});

test('fmtFeet shows feet and rounded inches', () => {
  assert.equal(fmtFeet(12), "12'");
  assert.equal(fmtFeet(12.5), `12' 6"`);
  assert.equal(fmtFeet(9.99), `10'`);
  assert.equal(fmtFeet(0.5), `0' 6"`);
});

test('areas add up and round to whole square feet', () => {
  const plan = { ...emptyPlan(), rooms: [newRoom('A', 0, 0, 10, 12), newRoom('B', 12, 0, 8.5, 9.5)] };
  assert.equal(roomArea(plan.rooms[0]), 120);
  assert.equal(totalArea(plan), Math.round(120 + 8.5 * 9.5));
  assert.equal(totalArea(emptyPlan()), 0);
});

test('normalizePlan repairs bad data instead of trusting it', () => {
  assert.deepEqual(normalizePlan(null), emptyPlan());
  assert.deepEqual(normalizePlan('x'), emptyPlan());
  const p = normalizePlan({
    rooms: [
      { id: 'a', label: 'L'.repeat(100), x: 'oops', y: 5, w: 100000, h: -3 },
      { id: 'a', label: 'dup id', x: 0, y: 0, w: 5, h: 5 },
      { id: 'c', pts: [[0, 0], [1, 1]] },
      null,
    ],
    marks: [
      { type: 'pen', color: 'javascript:alert(1)', pts: [[1, 2], ['x', 3], [4, 5]] },
      { type: 'text', text: '   ', x: 1, y: 1 },
      { type: 'text', text: 'Door', x: 1.234, y: 2, color: '#ff0000' },
      { type: 'zig' },
    ],
  });
  assert.equal(p.rooms.length, 2);
  assert.equal(p.rooms[0].label.length, 40);
  const box = roomBox(p.rooms[0]);
  assert.equal(box.x, 0);
  assert.equal(box.w, MAX_ROOM);
  assert.equal(box.h, MIN_ROOM);
  assert.notEqual(p.rooms[0].id, p.rooms[1].id);
  assert.equal(p.marks.length, 2);
  assert.match(p.marks[0].color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(p.marks[0].pts, [[1, 2], [4, 5]]);
  assert.equal(p.marks[1].x, 1.23);
});

test('a version 1 sketch (rectangles) opens as shapes, unchanged in size and place', () => {
  const p = normalizePlan({ v: 1, rooms: [{ id: 'k', label: 'Kitchen', x: 2, y: 3, w: 12, h: 14, notes: 'n' }], marks: [] });
  assert.equal(p.v, 2);
  assert.deepEqual(p.rooms[0].pts, [[2, 3], [14, 3], [14, 17], [2, 17]]);
  assert.equal(roomArea(p.rooms[0]), 168);
  assert.ok(isRect(p.rooms[0]));
  assert.deepEqual(p.water, []);
});

test('shapes and water survive a round trip through normalizePlan', () => {
  const room = { id: 'r', label: 'L', notes: '', pts: [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]] };
  const water = { id: 'w', cat: 2, smooth: true, pts: [[1, 1], [6, 1], [6, 6], [1, 6]] };
  const p = normalizePlan({ rooms: [room], water: [water, { pts: [[0, 0]] }, { cat: 9, pts: [[0, 0], [1, 0], [1, 1]] }] });
  assert.deepEqual(p.rooms[0].pts, room.pts);
  assert.equal(p.water.length, 2);
  assert.deepEqual(p.water[0], water);
  assert.equal(p.water[1].cat, 1);
  assert.equal(roomArea(room), 75);
  assert.ok(!isRect(room));
});

test('normalizePlan caps how many rooms it keeps', () => {
  const rooms = Array.from({ length: MAX_ROOMS + 20 }, (_, i) => ({ id: `r${i}`, x: i, y: 0, w: 5, h: 5 }));
  assert.equal(normalizePlan({ rooms }).rooms.length, MAX_ROOMS);
});

test('hit testing prefers the room on top and works for any shape', () => {
  const a = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  const b = { id: 'b', label: '', notes: '', pts: rectPts(5, 5, 10, 10) };
  const plan = { ...emptyPlan(), rooms: [a, b] };
  assert.equal(hitRoom(plan, 7, 7).id, 'b');
  assert.equal(hitRoom(plan, 2, 2).id, 'a');
  assert.equal(hitRoom(plan, 30, 30), null);
  const L = { id: 'L', label: '', notes: '', pts: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]] };
  assert.equal(hitRoom({ ...emptyPlan(), rooms: [L] }, 8, 8), null); // the notch
  assert.equal(hitRoom({ ...emptyPlan(), rooms: [L] }, 2, 8).id, 'L');
});

test('corners and walls are found near a point', () => {
  const r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  assert.equal(nearestVertex(r, 10.2, 9.8, 0.5), 2);
  assert.equal(nearestVertex(r, 5, 5, 0.5), -1);
  const e = nearestEdge(r, 5, 0.3, 0.5);
  assert.equal(e.i, 0);
  assert.equal(e.y, 0);
  assert.equal(nearestEdge(r, 5, 5, 0.5), null);
  const plan = { ...emptyPlan(), rooms: [r] };
  assert.deepEqual([nearestAnchor(plan, 9.9, 0.1, 0.5).x, nearestAnchor(plan, 9.9, 0.1, 0.5).y], [10, 0]);
  assert.equal(nearestAnchor(plan, 6.2, 0.2, 0.5).x, 6);
  assert.equal(nearestAnchor(plan, 5, 5, 0.5), null);
  assert.equal(nearestAnchor(plan, 10, 0, 0.5, 'a'), null);
});

test('a wall break cuts a wall in two so each side can move on its own', () => {
  const r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  const b = insertBreak(r, 0, 6.2, 0.1);
  assert.equal(b.pts.length, 6);
  assert.deepEqual(b.pts[1], [6, 0]);
  assert.deepEqual(b.pts[2], [6, 0]);
  assert.equal(roomArea(b), 100);
  // push the right half of the top wall up and out: the room grows a step
  const moved = moveEdge(b.pts, 2, 0, -3);
  assert.deepEqual(moved[2], [6, -3]);
  assert.deepEqual(moved[3], [10, -3]);
  assert.deepEqual(moved[1], [6, 0]);
  assert.equal(polyArea(moved), 100 + 4 * 3);
  // very short walls are left alone
  assert.equal(insertBreak({ ...r, pts: rectPts(0, 0, 0.5, 5) }, 0, 0.2, 0).pts.length, 4);
});

test('breaking a wall twice and pushing the piece between makes a bump or an inset', () => {
  let r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 12, 10) };
  r = insertBreak(r, 0, 4, 0);          // top wall at x = 4
  r = insertBreak(r, 2, 8, 0);          // the right-hand piece, at x = 8
  assert.equal(r.pts.length, 8);
  const mid = 2; // wall from the second point of the first break to the first point of the second
  assert.deepEqual([r.pts[mid], r.pts[mid + 1]], [[4, 0], [8, 0]]);
  const bump = moveEdge(r.pts, mid, 0, -2);
  assert.equal(polyArea(bump), 120 + 4 * 2);
  const inset = moveEdge(r.pts, mid, 0, 3);
  assert.equal(polyArea(inset), 120 - 4 * 3);
});

test('a new corner bends a wall into an angle; free moves are allowed', () => {
  const r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  const c = insertCorner(r, 1, 10, 5);
  assert.equal(c.pts.length, 5);
  assert.deepEqual(c.pts[2], [10, 5]);
  const bent = moveVertex(c.pts, 2, 13, 5, { free: true });
  assert.deepEqual(bent[2], [13, 5]);
  assert.deepEqual(bent[1], [10, 0]);
  assert.deepEqual(bent[3], [10, 10]);
  assert.equal(polyArea(bent), 100 + 0.5 * 10 * 3);
});

test('dragging a corner of a rectangle resizes it; dragging free skews it', () => {
  const pts = rectPts(0, 0, 10, 8);
  const grown = moveVertex(pts, 2, 14, 11);
  assert.deepEqual(grown, rectPts(0, 0, 14, 11));
  assert.ok(isRect({ pts: grown }));
  const skew = moveVertex(pts, 2, 14, 11, { free: true });
  assert.deepEqual(skew[1], [10, 0]);
  assert.ok(!isRect({ pts: skew }));
});

test('moving a wall keeps neighbouring walls square; walls of an L keep their corners', () => {
  const pts = rectPts(0, 0, 10, 8);
  assert.deepEqual(moveEdge(pts, 1, 4, 99), rectPts(0, 0, 14, 8)); // right wall: only sideways
  assert.deepEqual(moveEdge(pts, 0, 99, -2), rectPts(0, -2, 10, 10));
  const free = moveEdge(pts, 0, 3, -2, { free: true });
  assert.deepEqual([free[0], free[1]], [[3, -2], [13, -2]]);
});

test('dragging an angled wall slides its ends along the neighbouring walls, which keep their direction', () => {
  // a room with its top-left corner cut off: level top, plumb left, 45 degree wall between them
  const pts = [[3, 0], [15, 0], [15, 14], [0, 14], [0, 3]];
  const diag = 4; // from (0, 3) to (3, 0)
  const moved = moveEdge(pts, diag, 1.5, 1.5);
  assert.deepEqual(moved[4], [0, 6]);  // still on the left wall
  assert.deepEqual(moved[0], [6, 0]);  // still on the top wall
  assert.deepEqual([moved[1], moved[2], moved[3]], [pts[1], pts[2], pts[3]]);
  // only the part across the wall counts, and pulling it back out grows the room again
  assert.deepEqual(moveEdge(pts, diag, 1.5, 1.5), moveEdge(pts, diag, 3, 0));
  const out = moveEdge(pts, diag, -1, -1);
  assert.deepEqual([out[4], out[0]], [[0, 1], [1, 0]]);
  // snapped to half-foot steps across the wall; neighbours still level and plumb
  const snapped = moveEdgeSnapped(pts, diag, 1.2, 1.2);
  assert.equal(snapped[0][1], 0);
  assert.equal(snapped[4][0], 0);
  // free moves carry the two ends along as before
  const free = moveEdge(pts, diag, 1, 0, { free: true });
  assert.deepEqual([free[4], free[0]], [[1, 3], [4, 0]]);
});

test('a diagonal made with wall breaks slides along the real walls behind the breaks', () => {
  // cut the corner of a room the way it is done in the app: break the top and left walls, drop the corner
  let r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 15, 14) };
  r = insertBreak(r, 0, 3, 0);
  r = insertBreak(r, r.pts.length - 1, 0, 3);
  r = removeVertex(r, r.pts.findIndex((p) => p[0] === 0 && p[1] === 0));
  const diag = r.pts.findIndex((p, k) => {
    const q = r.pts[(k + 1) % r.pts.length];
    return p[0] === 0 && p[1] === 3 && q[0] === 3 && q[1] === 0;
  });
  assert.ok(diag >= 0);
  const moved = moveEdge(r.pts, diag, 1.5, 1.5);
  // every edge stays level, plumb, or the 45 degree diagonal: nothing tilted
  moved.forEach((p, k) => {
    const q = moved[(k + 1) % moved.length];
    const dx = Math.abs(q[0] - p[0]); const dy = Math.abs(q[1] - p[1]);
    assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6, `edge ${k} is tilted: ${JSON.stringify([p, q])}`);
  });
  assert.ok(moved.some((p) => p[0] === 0 && p[1] === 6));
  assert.ok(moved.some((p) => p[0] === 6 && p[1] === 0));
  assert.equal(polyArea(moved), 15 * 14 - 0.5 * 6 * 6);
});

test('a point left dead straight after an edit is dropped; breaks and real corners are kept', () => {
  // a square with its corner cut across: the point halfway along the diagonal is not a corner
  const cut = [[0, 0], [10, 0], [10, 10], [3, 10], [1.5, 8.5], [0, 7]];
  assert.deepEqual(dropStraightPoints(cut, [4]), [[0, 0], [10, 0], [10, 10], [3, 10], [0, 7]]);
  // only the points asked about are looked at
  assert.deepEqual(dropStraightPoints(cut, [0, 1]), cut);
  // real corners stay
  assert.deepEqual(dropStraightPoints(cut, [3, 5]), cut);
  // a wall break (two points in one spot) stays
  const brk = [[0, 0], [5, 0], [5, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(dropStraightPoints(brk, [1, 2]), brk);
  // a point that doubles back is a spike, not a straight line
  const spike = [[0, 0], [10, 0], [4, 0], [10, 10], [0, 10]];
  assert.deepEqual(dropStraightPoints(spike, [2]), spike);
  // a triangle keeps its three points
  assert.equal(dropStraightPoints([[0, 0], [5, 0], [10, 0]], [1]).length, 3);
  // indices wrap around the ends of the list
  assert.deepEqual(dropStraightPoints([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]], [-4]).length, 4);
});

test('the full story: square, wall breaks, step, delete the middle points, then drag the angle', () => {
  let r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  r = insertBreak(r, 2, 3, 10);                 // bottom wall, 3 ft from the left
  r = insertBreak(r, r.pts.length - 1, 0, 7);   // left wall, 7 ft down
  const corner = r.pts.findIndex((p) => p[0] === 0 && p[1] === 10);
  r = { ...r, pts: moveVertex(r.pts, corner, 3, 7) }; // pull the corner in: a 3 ft step
  assert.equal(polyArea(r.pts), 91);
  while (r.pts.some((p) => p[0] === 3 && p[1] === 7)) r = removeVertex(r, r.pts.findIndex((p) => p[0] === 3 && p[1] === 7));
  assert.deepEqual(r.pts, [[0, 0], [10, 0], [10, 10], [3, 10], [0, 7]]); // one straight angle, no middle point
  const diag = 3; // from (3, 10) to (0, 7)
  for (const [dx, dy, want] of [[1, -1, [[5, 10], [0, 5]]], [2, -2, [[7, 10], [0, 3]]], [-1, 1, [[1, 10], [0, 9]]]]) {
    const m = moveEdgeSnapped(r.pts, diag, dx, dy);
    assert.deepEqual([m[3], m[4]], want);
    assert.deepEqual([m[0], m[1], m[2]], [[0, 0], [10, 0], [10, 10]]); // untouched
    // the walls either side stay level and plumb: the ends only slide along them
    assert.equal(m[3][1], 10);
    assert.equal(m[4][0], 0);
  }
  // an in-between drag still lands on tidy numbers, never on a tilted neighbour
  const odd = moveEdgeSnapped(r.pts, diag, 0.8, -1.3);
  assert.equal(odd[3][1], 10);
  assert.equal(odd[4][0], 0);
  assert.equal(odd[3][0] % 0.5, 0);
  // selecting an end instead moves that corner itself (Alt held = free: the neighbours are not kept square)
  assert.deepEqual(moveVertex(r.pts, 3, 4, 9, { free: true })[3], [4, 9]);
});

test('dragging an angled wall next to a wall break never leaves a stray point behind', () => {
  // breaks on the bottom (x = 5) and left (y = 7) walls, the old corner pulled in to (2, 7)
  const pts = [[0, 0], [10, 0], [10, 10], [5, 10], [5, 10], [2, 7], [0, 7], [0, 7]];
  const m = moveEdgeSnapped(pts, 4, 1, -1);
  assert.deepEqual(m.slice(0, 3), pts.slice(0, 3));
  assert.deepEqual([m[3], m[4]], [[7, 10], [7, 10]]); // both halves of the break stay together on the bottom wall
  assert.deepEqual(m[5], [4, 7]);                      // the other end slides along the level 2 ft wall
  assert.deepEqual(m.slice(6), pts.slice(6));
});

test('Add corner: a click adds a corner, and a second click on the next wall cuts the corner off', () => {
  const sq = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  const one = addCornerCut(sq, 2, 3.1, 10);           // bottom wall, about 3 ft in from the left
  assert.deepEqual(one.point, [3, 10]);
  assert.equal(one.cut, false);
  assert.equal(one.room.pts.length, 5);               // a plain corner point, as before
  const two = addCornerCut(one.room, 4, 0, 7.2, one.point); // left wall: cuts the corner between them
  assert.equal(two.cut, true);
  assert.deepEqual(two.room.pts, [[0, 0], [10, 0], [10, 10], [3, 10], [0, 7]]);
  assert.equal(polyArea(two.room.pts), 100 - 0.5 * 3 * 3);
  // the other order works too, and on the other pair of walls
  const b1 = addCornerCut(sq, 3, 0, 6);               // left wall, 4 ft up from the bottom corner
  const b2 = addCornerCut(b1.room, 2, 4, 10, b1.point); // bottom wall
  assert.equal(b2.cut, true);
  assert.equal(b2.room.pts.length, 5);
  assert.equal(polyArea(b2.room.pts), 100 - 0.5 * 4 * 4);
  // walls that are not next to each other, the same wall, or no earlier click: just a new corner
  assert.equal(addCornerCut(one.room, 0, 5, 0, one.point).cut, false); // top wall: opposite side
  assert.equal(addCornerCut(one.room, 2, 6, 10, one.point).cut, false); // same wall as the first click
  assert.equal(addCornerCut(one.room, 4, 0, 7).cut, false);
  // a click right on an existing corner adds nothing
  assert.equal(addCornerCut(one.room, 4, 0, 10, one.point).point, null);
});

test('sliding a wall never runs a neighbour down to nothing', () => {
  const pts = [[3, 0], [15, 0], [15, 14], [0, 14], [0, 3]];
  const far = moveEdge(pts, 4, 50, 50); // way past the far corners
  assert.ok(far[0][0] > 3 && far[0][0] < 15 && far[0][1] === 0);
  assert.ok(far[4][1] > 3 && far[4][1] < 14 && far[4][0] === 0);
  assert.ok(polyArea(far) > 0);
  // a wall whose neighbours are parallel to it just moves across
  const slab = [[0, 0], [10, 0], [10, 5], [0, 5]];
  assert.deepEqual(moveEdge(slab, 0, 0, 2), [[0, 2], [10, 2], [10, 5], [0, 5]]);
});

test('typing a wall length moves the far end and keeps the room square', () => {
  const pts = rectPts(0, 0, 10, 8);
  assert.deepEqual(setEdgeLength(pts, 0, 14), rectPts(0, 0, 14, 8));
  assert.deepEqual(setEdgeLength(pts, 1, 5), rectPts(0, 0, 10, 5));
  assert.equal(setEdgeLength(pts, 0, -3), pts);
  const r = resizeRect({ id: 'a', pts }, 12.5, 9);
  assert.deepEqual(r.pts, rectPts(0, 0, 12.5, 9));
});

test('removing and tidying corners', () => {
  const r = { id: 'a', label: '', notes: '', pts: rectPts(0, 0, 10, 10) };
  const b = insertBreak(r, 0, 5, 0);
  assert.equal(tidyPts(b.pts).length, 4);          // an unused break disappears
  assert.equal(tidyPts(insertCorner(r, 0, 5, 0).pts).length, 4); // so does a corner that is not one
  assert.equal(removeVertex(r, 0).pts.length, 3);
  assert.equal(removeVertex(removeVertex(r, 0), 0).pts.length, 3); // never fewer than three
});

test('simplifyRDP keeps the shape of a line and drops the wobble', () => {
  const pts = Array.from({ length: 41 }, (_, i) => [i * 0.25, i < 20 ? 0.02 * (i % 2) : (i - 20) * 0.25 + 0.02 * (i % 2)]);
  const out = simplifyRDP(pts, 0.15);
  assert.ok(out.length >= 3 && out.length <= 5, String(out.length));
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
});

// a wobbly hand-drawn loop around a 10 x 6 area
function loop(w, h, wobble = 0.05, n = 120) {
  const out = [];
  const per = 2 * (w + h);
  for (let i = 0; i <= n; i += 1) {
    const d = (i / n) * per;
    let x; let y;
    if (d < w) { x = d; y = 0; } else if (d < w + h) { x = w; y = d - w; } else if (d < 2 * w + h) { x = w - (d - w - h); y = h; } else { x = 0; y = h - (d - 2 * w - h); }
    out.push([x + Math.sin(i * 1.7) * wobble, y + Math.cos(i * 2.3) * wobble]);
  }
  return out;
}

test('cleanWater turns a wobbly loop into a few clean corners (straight mode squares it up)', () => {
  const stroke = loop(10, 6);
  const straight = cleanWater(stroke, { mode: 'straight', eps: 0.3 });
  assert.equal(straight.length, 4);
  assert.ok(Math.abs(polyArea(straight) - 60) < 3);
  for (let i = 0; i < 4; i += 1) {
    const a = straight[i]; const b = straight[(i + 1) % 4];
    assert.ok(Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6, 'walls are level or plumb');
  }
  const smooth = cleanWater(stroke, { mode: 'smooth', eps: 0.3 });
  assert.ok(smooth.length >= 3 && smooth.length < 20);
  assert.ok(Math.abs(polyArea(smooth) - 60) < 6);
});

test('cleanWater keeps a shape that juts out in one place and back in at another', () => {
  // a wall of water that bulges out in the middle
  const stroke = [[0, 0], [4, 0], [5, 3], [8, 3.5], [11, 3], [12, 0], [16, 0], [16, 6], [12, 6], [8, 5.5], [4, 6], [0, 6], [0, 0]];
  const dense = [];
  for (let i = 1; i < stroke.length; i += 1) {
    for (let t = 0; t < 10; t += 1) dense.push([stroke[i - 1][0] + ((stroke[i][0] - stroke[i - 1][0]) * t) / 10, stroke[i - 1][1] + ((stroke[i][1] - stroke[i - 1][1]) * t) / 10]);
  }
  const out = cleanWater(dense, { mode: 'smooth', eps: 0.3 });
  assert.ok(out.length >= 8, `kept ${out.length} corners`);
  const ys = out.map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 5.9);
});

test('cleanWater refuses a drawing that is too small or not a loop', () => {
  assert.equal(cleanWater([[0, 0], [0.5, 0]]), null);
  assert.equal(cleanWater([[0, 0], [0.2, 0.1], [0.1, 0.2]]), null);
  assert.equal(cleanWater([]), null);
});

test('wet area is measured per room, counts overlaps once, and reports the worst category', () => {
  const kitchen = { id: 'k', label: 'Kitchen', notes: '', pts: rectPts(0, 0, 12, 10) };
  const hall = { id: 'h', label: 'Hall', notes: '', pts: rectPts(12, 0, 4, 10) };
  const dry = { id: 'd', label: 'Dry', notes: '', pts: rectPts(30, 0, 5, 5) };
  const w1 = { id: 'w1', cat: 1, smooth: false, pts: rectPts(6, 2, 10, 4) };    // 6 sq ft... see below
  const w2 = { id: 'w2', cat: 3, smooth: false, pts: rectPts(8, 2, 4, 4) };     // inside w1
  const plan = { ...emptyPlan(), rooms: [kitchen, hall, dry], water: [w1, w2] };
  const wet = wetAreas(plan);
  assert.equal(wet.k.wet, 6 * 4);      // x 6..12
  assert.equal(wet.h.wet, 4 * 4);      // x 12..16
  assert.equal(wet.k.cat, 3);
  assert.equal(wet.h.cat, 1);
  assert.equal(wet.d, undefined);
  assert.equal(totalWet(wet), 24 + 16);
  assert.deepEqual(wetAreas(emptyPlan()), {});
});

test('a smooth water shape is measured as drawn and can be picked', () => {
  const w = newWater([[2, 2], [8, 2], [8, 6], [2, 6]], 2, true);
  const out = waterOutline(w);
  assert.ok(out.length > 4);
  assert.ok(polyArea(out) < 24 && polyArea(out) > 15); // rounded corners trim a little
  const plan = { ...emptyPlan(), water: [w] };
  assert.equal(hitWater(plan, 5, 4).id, w.id);
  assert.equal(hitWater(plan, 20, 4), null);
  assert.equal(waterOutline({ ...w, smooth: false }), w.pts);
});

test('a room name is placed inside an odd shape', () => {
  const L = { id: 'L', pts: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]] };
  const c = labelPoint(L);
  assert.ok(hitRoom({ ...emptyPlan(), rooms: [L] }, c.x, c.y));
});

test('pen strokes and text notes can be picked', () => {
  const plan = {
    ...emptyPlan(),
    marks: [
      { id: 'p', type: 'pen', color: '#000000', pts: [[0, 0], [10, 0]] },
      { id: 't', type: 'text', color: '#000000', x: 20, y: 20, text: 'Door' },
    ],
  };
  assert.equal(hitMarkAt(plan, 5, 0.3, 0.5).id, 'p');
  assert.equal(hitMarkAt(plan, 5, 3, 0.5), null);
  assert.equal(hitMarkAt(plan, 21, 19.5, 0.5).id, 't');
  assert.ok(Math.abs(distToSegment(5, 3, 0, 0, 10, 0) - 3) < 1e-9);
  assert.ok(Math.abs(distToSegment(15, 0, 0, 0, 10, 0) - 5) < 1e-9);
});

test('simplifyStroke thins points but keeps the ends', () => {
  const pts = Array.from({ length: 100 }, (_, i) => [i * 0.01, 0]);
  const out = simplifyStroke(pts, 0.5);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[99]);
  assert.ok(out.length < 10);
  assert.equal(simplifyStroke([[0, 0]], 1).length, 1);
});

test('fitView centres the drawing and screen/world conversion round-trips', () => {
  const plan = { ...emptyPlan(), rooms: [newRoom('A', 0, 0, 20, 10)] };
  const view = fitView(planBounds(plan), 400, 300);
  const tl = toScreen(view, 0, 0);
  const br = toScreen(view, 20, 10);
  assert.ok(tl.x >= 0 && br.x <= 400 && tl.y >= 0 && br.y <= 300);
  assert.ok(Math.abs((tl.x + br.x) / 2 - 200) < 1);
  const w = toWorld(view, tl.x + 37, tl.y + 11);
  assert.ok(Math.abs(w.x - 37 / view.scale) < 1e-9 && Math.abs(w.y - 11 / view.scale) < 1e-9);
  assert.equal(planBounds(emptyPlan()), null);
  assert.ok(fitView(null, 400, 300).scale > 0);
});

test('room photo counts ignore archived photos and other sketches', () => {
  const photos = [
    { sketch_id: 's1', room_key: 'a' }, { sketch_id: 's1', room_key: 'a' }, { sketch_id: 's1', room_key: 'b' },
    { sketch_id: 's2', room_key: 'a' }, { sketch_id: 's1', room_key: 'a', archived_at: '2026-11-01' }, { sketch_id: 's1', room_key: null },
  ];
  assert.deepEqual(roomPhotoCounts(photos, 's1'), { a: 2, b: 1 });
});

// A stand-in canvas context that records calls, to be sure drawing never throws.
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      return (...a) => { calls.push([k, ...a]); };
    },
    set() { return true; },
  });
  return ctx;
}

test('drawPlan renders rooms, labels, marks, selection and a draft without throwing', () => {
  const plan = normalizePlan({
    rooms: [{ id: 'k', label: 'Kitchen', x: 0, y: 0, w: 12, h: 14 }, { id: 'h', label: 'Hall', x: 12, y: 0, w: 3, h: 14 }],
    water: [{ id: 'w', cat: 2, smooth: true, pts: [[1, 1], [9, 1], [9, 8], [1, 8]] }],
    marks: [{ type: 'pen', color: '#c0392b', pts: [[1, 1], [5, 5]] }, { type: 'text', text: 'Wet', x: 2, y: 3, color: '#2f4858' }],
  });
  const view = fitView(planBounds(plan), 400, 300);
  const ctx = fakeCtx();
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'room', id: 'k' }, counts: { k: 3 }, draft: { type: 'room', x: 20, y: 0, w: 5, h: 5 } });
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'mark', id: plan.marks[1].id }, draft: { type: 'pen', color: '#000000', pts: [[0, 0], [1, 1]] } });
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'room', id: 'k', vi: 2, ei: 1 }, wet: wetAreas(plan), hover: { x: 3, y: 0, kind: 'break' } });
  drawPlan(ctx, plan, view, { W: 400, H: 300, selection: { kind: 'water', id: 'w' }, draft: { type: 'water', cat: 2, pts: [[0, 0], [3, 1]] } });
  // hovering the top wall of the kitchen (12 ft) at 3 ft: 3' on one side and 9' on the other, with the cut preview
  const kit = plan.rooms[0];
  const hctx = fakeCtx();
  drawPlan(hctx, plan, view, { W: 400, H: 300, hover: { x: 3, y: 0, kind: 'corner', a: kit.pts[0], b: kit.pts[1], pts: kit.pts, from: { x: 0, y: 4 } }, pending: { x: 0, y: 4 } });
  const hoverText = hctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(hoverText.includes("3'") && hoverText.includes("9'"), `split lengths missing: ${hoverText}`);
  drawPlan(ctx, emptyPlan(), view, { W: 400, H: 300 });
  const text = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(text.includes('Kitchen'));
  assert.ok(text.some((t) => t.includes('168 sq ft')));
  assert.ok(text.includes('3'));
  assert.ok(text.some((t) => t.startsWith('Wet ~')));
  assert.ok(text.includes(`12'`)); // wall lengths on the selected room
});

test('carving: a new room cuts its overlap out of a neighbour', () => {
  const rooms = [{ id: 'a', label: 'A', notes: '', pts: rectPts(0, 0, 10, 10) }];
  const top = carveRooms(rooms, { x: 0, y: 0, w: 10, h: 4 }); // dragged up over the top
  assert.equal(top.length, 1);
  assert.equal(roomArea(top[0]), 60);
  const corner = carveRooms(rooms, { x: 6, y: 0, w: 6, h: 4 }); // L-shape stays one room
  assert.equal(corner.length, 1);
  assert.equal(roomArea(corner[0]), 100 - 16);
  const split = carveRooms(rooms, { x: 4, y: -2, w: 2, h: 14 }); // cut in two
  assert.equal(split.length, 2);
  assert.equal(split[0].id, 'a');
  assert.equal(roomArea(split[0]) + roomArea(split[1]), 80);
  assert.equal(carveRooms(rooms, { x: -1, y: -1, w: 12, h: 12 }).length, 0); // covered
  assert.equal(carveRooms(rooms, { x: 10, y: 0, w: 5, h: 5 })[0], rooms[0]); // only touching
  assert.equal(carveRooms(rooms, { x: 2, y: 2, w: 3, h: 3 })[0], rooms[0]); // inside: no hole
  assert.ok(subtractRect(rectPts(0, 0, 10, 10), { x: 0, y: 0, w: 10, h: 4 }).length === 1);
});
