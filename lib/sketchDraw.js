// Draws a sketch onto a 2D canvas context. Shared by the editor and the PNG export.
// Only uses the context it is handed (no DOM), so it also runs against a stand-in in tests.
import { fmtFeet, roomSizeText, roomAreaText, toScreen, toWorld, polyBox, labelPoint, waterOutline, rectPts } from './sketch.js';

const INK = '#2f4858';
const SELECT = '#54e9de';
export const TEXT_HEIGHT_FT = 1.4;

function drawGrid(ctx, view, W, H) {
  const { scale } = view;
  const step = scale >= 14 ? 1 : scale >= 5 ? 5 : 0;
  if (!step) return;
  const a = toWorld(view, 0, 0);
  const b = toWorld(view, W, H);
  ctx.lineWidth = 1;
  for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) {
    const sx = Math.round(x * scale + view.ox) + 0.5;
    ctx.strokeStyle = Math.abs(x % 5) < 1e-9 ? '#dcd8cf' : '#efede7';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) {
    const sy = Math.round(y * scale + view.oy) + 0.5;
    ctx.strokeStyle = Math.abs(y % 5) < 1e-9 ? '#dcd8cf' : '#efede7';
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }
}

function drawStroke(ctx, view, pts, color, width = 2.5) {
  if (!pts.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const first = toScreen(view, pts[0][0], pts[0][1]);
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(first.x, first.y, width / 2 + 0.5, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = toScreen(view, pts[i][0], pts[i][1]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawText(ctx, view, m, selected) {
  const px = Math.max(9, TEXT_HEIGHT_FT * view.scale);
  const p = toScreen(view, m.x, m.y);
  ctx.font = `700 ${px}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = m.color;
  ctx.fillText(m.text, p.x, p.y);
  if (selected) {
    const w = ctx.measureText(m.text).width;
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(p.x - 3, p.y - px, w + 6, px + 6);
    ctx.setLineDash([]);
  }
}

function tracePoly(ctx, view, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = toScreen(view, p[0], p[1]);
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
}

const handle = (ctx, x, y, on) => {
  ctx.fillStyle = on ? SELECT : '#fff';
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 2;
  ctx.fillRect(x - 6, y - 6, 12, 12);
  ctx.strokeRect(x - 6, y - 6, 12, 12);
};

function drawRoom(ctx, view, r, { selected, count, ghost, vertex = -1, edge = -1, wet = null }) {
  const pts = r.pts;
  tracePoly(ctx, view, pts);
  ctx.fillStyle = ghost ? 'rgba(47,72,88,0.06)' : '#eaf1f5';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  if (ghost) ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // text, kept inside the room
  const box = polyBox(pts);
  const w = box.w * view.scale;
  const h = box.h * view.scale;
  ctx.save();
  tracePoly(ctx, view, pts);
  ctx.clip();
  const fs = Math.min(18, Math.max(10, view.scale * 1.15));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const lines = [];
  if (r.label) lines.push({ t: r.label, bold: true });
  if (w > 70 && h > 36 && !ghost) lines.push({ t: roomSizeText(r), bold: false });
  if (w > 70 && h > 54 && !ghost) lines.push({ t: roomAreaText(r), bold: false });
  if (wet && w > 70 && h > 54) lines.push({ t: `Wet ~${wet.wet} sq ft`, bold: true, color: '#1f6fd0' });
  const c = ghost ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : labelPoint(r);
  const cs = toScreen(view, c.x, c.y);
  const lh = fs * 1.25;
  let y = cs.y - ((lines.length - 1) * lh) / 2;
  for (const ln of lines) {
    ctx.font = `${ln.bold ? 700 : 500} ${fs}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = ln.color || INK;
    ctx.fillText(ln.t, cs.x, y);
    y += lh;
  }
  ctx.restore();

  if (count > 0) {
    const tr = toScreen(view, box.maxX, box.minY);
    const cx = tr.x - 13;
    const cy = tr.y + 13;
    ctx.fillStyle = SELECT;
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), cx, cy + 0.5);
  }
}

// The selected room is drawn last, on top of its neighbours, so every side of it shows (a room next to it
// would otherwise cover the shared wall).
function drawRoomSelection(ctx, view, r, { vertex = -1, edge = -1 }) {
  const pts = r.pts;
  tracePoly(ctx, view, pts);
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  // the wall being worked on
  if (edge >= 0 && edge < pts.length) {
    const a = toScreen(view, pts[edge][0], pts[edge][1]);
    const b = toScreen(view, pts[(edge + 1) % pts.length][0], pts[(edge + 1) % pts.length][1]);
    ctx.strokeStyle = '#2d7ff9';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  {
    // wall lengths
    ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.9 || len * view.scale < 38) return;
      const m = toScreen(view, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      // push the label a little outside the room
      const nx = -(q[1] - p[1]) / len; const ny = (q[0] - p[0]) / len;
      const probe = { x: (p[0] + q[0]) / 2 + nx * 0.4, y: (p[1] + q[1]) / 2 + ny * 0.4 };
      const sign = pointInPolyLocal(pts, probe.x, probe.y) ? -1 : 1;
      const tx = m.x + sign * nx * 12; const ty = m.y + sign * ny * 12;
      const label = fmtFeet(len);
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(tx - tw / 2, ty - 8, tw, 16);
      ctx.fillStyle = i === edge ? '#2d7ff9' : INK;
      ctx.fillText(label, tx, ty);
    });
    // corners
    pts.forEach((p, i) => { const q = toScreen(view, p[0], p[1]); handle(ctx, q.x, q.y, i === vertex); });
  }
}

function pointInPolyLocal(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const WATER_FILL = { 1: 'rgba(45,127,249,0.34)', 2: 'rgba(100,128,140,0.45)', 3: 'rgba(52,38,30,0.55)' };
export const WATER_LINE = { 1: '#1f6fd0', 2: '#4c6a77', 3: '#3a2a20' };

function drawWater(ctx, view, w, { selected }) {
  const outline = waterOutline(w);
  tracePoly(ctx, view, outline);
  ctx.fillStyle = WATER_FILL[w.cat] || WATER_FILL[1];
  ctx.fill();
  ctx.strokeStyle = selected ? SELECT : WATER_LINE[w.cat] || WATER_LINE[1];
  ctx.lineWidth = selected ? 3 : 1.8;
  ctx.setLineDash([7, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (selected) w.pts.forEach((p) => { const q = toScreen(view, p[0], p[1]); handle(ctx, q.x, q.y, false); });
}

// opts: { W, H, selection: {kind,id,vi?,ei?}|null, counts: {roomId: n}, wet: {roomId: {wet,cat}}, draft: {...}|null,
//         hover: {x,y,kind,a,b,pts,from}|null (a, b: ends of the hovered wall), pending: {x,y}|null, grid: bool }
export function drawPlan(ctx, plan, view, opts = {}) {
  const { W, H, selection = null, counts = {}, wet = {}, draft = null, hover = null, pending = null, grid = true } = opts;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (grid) drawGrid(ctx, view, W, H);
  for (const r of plan.rooms) {
    const on = selection?.kind === 'room' && selection.id === r.id;
    drawRoom(ctx, view, r, { selected: on, count: counts[r.id] || 0, wet: wet[r.id] || null });
  }
  for (const w of plan.water || []) drawWater(ctx, view, w, { selected: selection?.kind === 'water' && selection.id === w.id });
  // the selected room goes on top of everything drawn so far, so all of its sides show
  if (selection?.kind === 'room') {
    const sr = plan.rooms.find((r) => r.id === selection.id);
    if (sr) drawRoomSelection(ctx, view, sr, { vertex: selection.vi ?? -1, edge: selection.ei ?? -1 });
  }
  for (const m of plan.marks) {
    const selected = selection?.kind === 'mark' && selection.id === m.id;
    if (m.type === 'pen') drawStroke(ctx, view, m.pts, selected ? SELECT : m.color, selected ? 3.5 : 2.5);
    else drawText(ctx, view, m, selected);
  }
  if (draft?.type === 'room') {
    drawRoom(ctx, view, { id: 'draft', label: '', pts: rectPts(draft.x, draft.y, draft.w, draft.h) }, { selected: false, count: 0, ghost: true });
    const tl = toScreen(view, draft.x, draft.y);
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.fillStyle = SELECT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${fmtFeet(draft.w)} × ${fmtFeet(draft.h)}`, tl.x, tl.y - 4);
  } else if (draft?.type === 'pen') {
    drawStroke(ctx, view, draft.pts, draft.color);
  } else if (draft?.type === 'water') {
    drawStroke(ctx, view, draft.pts, WATER_LINE[draft.cat] || WATER_LINE[1], 3);
  }
  const tint = (kind) => (kind === 'break' ? '#2d7ff9' : '#3a6b45');
  if (pending) { // the first click of an Add corner cut, waiting for the second
    const q = toScreen(view, pending.x, pending.y);
    ctx.strokeStyle = '#3a6b45';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a6b45';
    ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  if (hover) {
    const q = toScreen(view, hover.x, hover.y);
    if (hover.from) { // where the cut would run
      const f = toScreen(view, hover.from.x, hover.from.y);
      ctx.strokeStyle = tint(hover.kind);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hover.a && hover.b) drawSplitLengths(ctx, view, hover, tint(hover.kind));
    ctx.fillStyle = tint(hover.kind);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

// While hovering a wall with the Break or Corner tool: how long the wall is on each side of the circle.
function drawSplitLengths(ctx, view, h, color) {
  const q = toScreen(view, h.x, h.y);
  ctx.font = '700 12px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const wallLen = Math.hypot(h.b[0] - h.a[0], h.b[1] - h.a[1]);
  if (wallLen < 1e-6) return;
  const ux = (h.b[0] - h.a[0]) / wallLen; const uy = (h.b[1] - h.a[1]) / wallLen; // along the wall, a to b
  const nx = -uy; const ny = ux;
  // keep the labels off the room: on the outside of the wall
  const probe = { x: h.x + nx * 0.4, y: h.y + ny * 0.4 };
  const side = h.pts && pointInPolyLocal(h.pts, probe.x, probe.y) ? -1 : 1;
  for (const [far, dir] of [[h.a, -1], [h.b, 1]]) {
    const len = Math.hypot(far[0] - h.x, far[1] - h.y);
    if (len < 0.02) continue;
    const along = Math.max((len * view.scale) / 2, 30); // centred on its half, but never piled on the circle
    const cx = q.x + dir * ux * along + side * nx * 18;
    const cy = q.y + dir * uy * along + side * ny * 18;
    const label = fmtFeet(len);
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - tw / 2, cy - 10, tw, 20, 6); else ctx.rect(cx - tw / 2, cy - 10, tw, 20);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, cx, cy);
  }
}
