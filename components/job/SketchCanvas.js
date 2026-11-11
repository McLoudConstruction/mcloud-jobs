'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MARK_COLORS, MAX_MARKS, MAX_ROOMS, MAX_WATER, MIN_ROOM, MAX_ROOM, ROOM_PRESETS, WATER_CATS,
  addCornerCut, carveRooms, cleanWater, dropStraightPoints, edgeLength, fitView, hitMarkAt, hitRoom, hitWater, insertBreak, insertCorner, isRect, makeId, moveEdgeSnapped,
  moveVertex, nearestAnchor, nearestEdge, nearestVertex, newRoom, newWater, normalizePlan, parseFeet, planBounds,
  polyArea, rectPts, removeVertex, resizeRect, roomAreaText, roomBox, roomSizeText, setEdgeLength,
  simplifyStroke, snap, snapOnEdge, tidyPts, toWorld, totalArea, totalWet, translatePts, waterOutline, wetAreas, fmtFeet,
} from '@/lib/sketch';
import { drawPlan, WATER_LINE } from '@/lib/sketchDraw';

const TOOLS = [
  ['select', 'Select', 'V'],
  ['pan', 'Move view', 'H'],
  ['room', 'Draw room', 'R'],
  ['break', 'Wall break', 'B'],
  ['corner', 'Add corner', 'C'],
  ['water', 'Water', 'W'],
  ['pen', 'Pen', 'P'],
  ['text', 'Text', 'T'],
];
const KEYS = { v: 'select', h: 'pan', r: 'room', b: 'break', c: 'corner', w: 'water', p: 'pen', t: 'text' };
const HINTS = {
  select: 'Click a room to select it, then drag its corners or walls. Hold Alt (or turn on Angles) to move a corner in any direction. Hold Ctrl and drag a corner or wall to start a new room there. Double-click a corner, or press Delete with it selected, to remove it.',
  pan: 'Drag to move around. Pinch or scroll to zoom.',
  room: 'Drag on the sketch to draw a room. It snaps to the corners and walls of rooms already there.',
  break: 'Hover a wall and click to cut it in two. Switch to Select (V), then drag either side of the cut in or out.',
  corner: 'Hover a wall and click to add a corner. To cut off a corner of a room, click one wall, then click the wall next to it. The tool stays on, so keep clicking. Esc starts over.',
  water: 'Draw around where the water went with your finger or mouse. It is cleaned up and colored when you let go.',
  pen: 'Draw freehand: doors, arrows, anything. Tap a line with Select to remove it.',
  text: 'Tap where the note should go, then type it.',
};
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const inField = (el) => {
  const tag = (el?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
};

// The drawing board. Works in feet. The parent owns saving: onChange gets the whole new plan after
// each finished change. The plan prop is read once (the parent remounts this with a new key to
// switch sketches).
export default function SketchCanvas({ plan: initialPlan, onChange, photoCounts = {}, onAddRoomPhoto, onViewRoomPhotos, exportName = 'sketch' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rootRef = useRef(null);
  const planRef = useRef(normalizePlan(initialPlan));
  const wetRef = useRef({ plan: null, wet: {} });
  const viewRef = useRef({ scale: 14, ox: 40, oy: 40 });
  const dragRef = useRef(null);      // gesture in progress: { mode, plan?, draft?, ... }
  const hoverRef = useRef(null);
  const lastCornerRef = useRef(null); // Add corner: the point the last click added, { roomId, x, y }
  const pointers = useRef(new Map());
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const sizeRef = useRef({ W: 300, H: 400 });
  const countsRef = useRef(photoCounts);
  const rafRef = useRef(0);

  const [tool, setTool] = useState('select');
  const [sel, setSel] = useState(null); // { kind: 'room' | 'mark' | 'water', id, vi?, ei? }
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [waterCat, setWaterCat] = useState(1);
  const [waterMode, setWaterMode] = useState('smooth');
  const [freeAngle, setFreeAngle] = useState(false);
  const [textDraft, setTextDraft] = useState(null); // { x, y, value }
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [, bump] = useState(0);
  const [dimErr, setDimErr] = useState('');
  const selRef = useRef(null);
  selRef.current = sel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const waterRef = useRef({ cat: 1, mode: 'smooth' });
  waterRef.current = { cat: waterCat, mode: waterMode };
  const freeRef = useRef(false);
  freeRef.current = freeAngle;

  // how much of each room is wet; worked out when the plan changes, not while dragging
  const wetFor = (plan) => {
    if (wetRef.current.plan !== plan) wetRef.current = { plan, wet: wetAreas(plan) };
    return wetRef.current.wet;
  };

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = dragRef.current;
    const committed = planRef.current;
    if (wetRef.current.plan !== committed) wetRef.current = { plan: committed, wet: wetAreas(committed) };
    drawPlan(ctx, d?.plan || committed, viewRef.current, {
      W: sizeRef.current.W, H: sizeRef.current.H, selection: selRef.current, counts: countsRef.current,
      wet: wetRef.current.wet, draft: d?.draft || null, hover: d ? null : hoverRef.current,
      pending: toolRef.current === 'corner' ? lastCornerRef.current : null,
    });
  }, []);
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  useEffect(() => { countsRef.current = photoCounts; schedule(); }, [photoCounts, schedule]);
  useEffect(() => { schedule(); setDimErr(''); }, [sel, schedule]);
  useEffect(() => { hoverRef.current = null; lastCornerRef.current = null; schedule(); }, [tool, schedule]);

  // size the canvas to its box, keep it crisp on high-density screens, and fit the drawing once
  const fittedRef = useRef(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return undefined;
    const resize = () => {
      const W = Math.max(200, wrap.clientWidth);
      const H = Math.max(240, wrap.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      sizeRef.current = { W, H };
      if (!fittedRef.current) {
        viewRef.current = fitView(planBounds(planRef.current), W, H);
        fittedRef.current = true;
      }
      draw();
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [draw]);

  // ---- changes -----------------------------------------------------------
  const commit = useCallback((next) => {
    undoRef.current.push(planRef.current);
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(false);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }, [onChange, schedule]);

  const findSel = (plan, s) => {
    if (!s) return null;
    const list = s.kind === 'room' ? plan.rooms : s.kind === 'water' ? plan.water : plan.marks;
    return list.find((x) => x.id === s.id) || null;
  };

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    if (selRef.current && !findSel(prev, selRef.current)) setSel(null);
    onChange?.(prev);
    bump((n) => n + 1);
    schedule();
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    if (selRef.current && !findSel(next, selRef.current)) setSel(null);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }

  const selected = findSel(planRef.current, sel);

  function patchRoom(id, patch) {
    commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function patchMark(id, patch) {
    commit({ ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function patchWater(id, patch) {
    commit({ ...planRef.current, water: planRef.current.water.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  }
  function removeSelected() {
    const s = selRef.current;
    if (!s) return;
    const p = planRef.current;
    if (s.kind === 'room' && s.vi != null && s.vi >= 0) { // a corner is selected: remove just that corner
      const r = p.rooms.find((x) => x.id === s.id);
      if (r && r.pts.length > 3) { patchRoom(r.id, { pts: removeVertex(r, s.vi).pts }); setSel({ kind: 'room', id: r.id }); return; }
    }
    if (s.kind === 'room') commit({ ...p, rooms: p.rooms.filter((r) => r.id !== s.id) });
    else if (s.kind === 'water') commit({ ...p, water: p.water.filter((w) => w.id !== s.id) });
    else commit({ ...p, marks: p.marks.filter((m) => m.id !== s.id) });
    setSel(null);
  }

  function addRoom() {
    const p = planRef.current;
    if (p.rooms.length >= MAX_ROOMS) return;
    const { W, H } = sizeRef.current;
    const c = toWorld(viewRef.current, W / 2, H / 2);
    // nudge so a new room never lands exactly on top of another
    const same = (rm) => { const b = roomBox(rm); return b.x === snap(c.x - 5 + n) && b.y === snap(c.y - 5 + n); };
    let n = 0;
    while (p.rooms.some(same) && n < 20) n += 1;
    const room = newRoom('', c.x - 5 + n, c.y - 5 + n);
    commit({ ...p, rooms: [...p.rooms, room] });
    setSel({ kind: 'room', id: room.id });
    setTool('select');
  }

  function duplicateRoom() {
    const r = selected;
    if (!r || sel.kind !== 'room' || planRef.current.rooms.length >= MAX_ROOMS) return;
    const b = roomBox(r);
    const copy = { ...r, id: makeId(), pts: translatePts(r.pts, snap(b.w + 1), 0), label: r.label ? `${r.label} 2` : '' };
    commit({ ...planRef.current, rooms: [...planRef.current.rooms, copy] });
    setSel({ kind: 'room', id: copy.id });
  }

  // ---- view --------------------------------------------------------------
  function zoomAt(factor, sx, sy) {
    const v = viewRef.current;
    const scale = clampN(v.scale * factor, 3, 120);
    const w = toWorld(v, sx, sy);
    viewRef.current = { scale, ox: sx - w.x * scale, oy: sy - w.y * scale };
    schedule();
  }
  const zoomCenter = (f) => zoomAt(f, sizeRef.current.W / 2, sizeRef.current.H / 2);
  function fit() {
    viewRef.current = fitView(planBounds(planRef.current), sizeRef.current.W, sizeRef.current.H);
    schedule();
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // zoomAt only uses refs, so the first copy is always current
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer gestures --------------------------------------------------
  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // a corner snaps to another room's corner when it is close, otherwise to the grid
  function snapCorner(plan, x, y, tolFt, skip) {
    let best = null;
    let bestD = tolFt;
    for (const r of plan.rooms) {
      r.pts.forEach((p, i) => {
        if (skip && r.id === skip.id && i === skip.i) return;
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d <= bestD) { best = p; bestD = d; }
      });
    }
    return best ? { x: best[0], y: best[1] } : { x: snap(x), y: snap(y) };
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    rootRef.current?.focus({ preventScroll: true }); // so the shortcut keys work
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) { // second finger: pinch and pan, drop whatever was being drawn
      const [a, b] = [...pointers.current.values()];
      dragRef.current = {
        mode: 'pinch', view: { ...viewRef.current },
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      schedule();
      return;
    }
    if (pointers.current.size > 2) return;

    const v = viewRef.current;
    const w = toWorld(v, p.x, p.y);
    const plan = planRef.current;
    const tolFt = 12 / v.scale; // 12 screen pixels, in feet
    const edgeTol = 9 / v.scale;
    const t = toolRef.current;
    const ctrl = e.ctrlKey || e.metaKey;

    if (t === 'pan') { dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy }; return; }

    // a new room: starts on a nearby corner or wall of an existing room when there is one
    if (t === 'room' || (t === 'select' && ctrl)) {
      const a = nearestAnchor(plan, w.x, w.y, tolFt);
      const x = a ? a.x : snap(w.x); const y = a ? a.y : snap(w.y);
      dragRef.current = { mode: 'room', x0: x, y0: y, draft: { type: 'room', x, y, w: 0, h: 0 } };
      schedule();
      return;
    }
    if (t === 'break' || t === 'corner') {
      let hit = null;
      for (let i = plan.rooms.length - 1; i >= 0 && !hit; i -= 1) {
        const ed = nearestEdge(plan.rooms[i], w.x, w.y, edgeTol * 1.3);
        if (ed) hit = { room: plan.rooms[i], ed };
      }
      if (hit && t === 'break') {
        const next = insertBreak(hit.room, hit.ed.i, hit.ed.x, hit.ed.y);
        if (next !== hit.room) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? next : r)) });
          setSel({ kind: 'room', id: hit.room.id, ei: hit.ed.i });
        }
      } else if (hit) {
        // Add corner: the first click adds a corner and waits; a click on the next wall cuts the corner between them
        const last = lastCornerRef.current;
        const res = addCornerCut(hit.room, hit.ed.i, hit.ed.x, hit.ed.y, last && last.roomId === hit.room.id ? [last.x, last.y] : null);
        if (res.point) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? res.room : r)) });
          setSel({ kind: 'room', id: hit.room.id });
          lastCornerRef.current = res.cut ? null : { roomId: hit.room.id, x: res.point[0], y: res.point[1] };
        }
      } else {
        lastCornerRef.current = null; // a click on empty space starts over
      }
      hoverRef.current = null;
      schedule();
      dragRef.current = null;
      return;
    }
    if (t === 'pen') {
      dragRef.current = { mode: 'pen', pts: [[w.x, w.y]], draft: { type: 'pen', color: colorRef.current, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'water') {
      dragRef.current = { mode: 'water', pts: [[w.x, w.y]], draft: { type: 'water', cat: waterRef.current.cat, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'text') { dragRef.current = { mode: 'text', sx: p.x, sy: p.y, wx: w.x, wy: w.y }; return; }

    // select tool. The selected shape's own corners and walls come first.
    const s = selRef.current;
    const cur = findSel(plan, s);
    if (cur && s.kind === 'room') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) {
        setSel({ kind: 'room', id: cur.id, vi });
        dragRef.current = { mode: 'vertex', id: cur.id, i: vi, plan, moved: false };
        schedule();
        return;
      }
      const ed = nearestEdge(cur, w.x, w.y, edgeTol);
      if (ed) {
        setSel({ kind: 'room', id: cur.id, ei: ed.i });
        dragRef.current = { mode: 'edge', id: cur.id, i: ed.i, wx: w.x, wy: w.y, orig: cur.pts, plan, moved: false };
        schedule();
        return;
      }
    }
    if (cur && s.kind === 'water') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) { dragRef.current = { mode: 'wvertex', id: cur.id, i: vi, plan, moved: false }; return; }
    }
    const mark = hitMarkAt(plan, w.x, w.y, tolFt * 0.6);
    const water = hitWater(plan, w.x, w.y);
    const room = hitRoom(plan, w.x, w.y);
    // water is picked by its edge, or anywhere on it when no room is under it, so a wet room can still be selected
    const waterEdge = water && nearestEdge({ pts: waterOutline(water) }, w.x, w.y, edgeTol * 1.4);
    const pickWater = water && (waterEdge || !room || (cur && s.kind === 'water' && cur.id === water.id));
    // a pen stroke or note lying on a room wins over the room under it
    if (mark) {
      setSel({ kind: 'mark', id: mark.id });
      dragRef.current = { mode: 'move-mark', id: mark.id, wx: w.x, wy: w.y, orig: mark, plan, moved: false };
    } else if (pickWater) {
      setSel({ kind: 'water', id: water.id });
      dragRef.current = { mode: 'move-water', id: water.id, wx: w.x, wy: w.y, orig: water.pts, plan, moved: false };
    } else if (room) {
      setSel({ kind: 'room', id: room.id });
      dragRef.current = { mode: 'move-room', id: room.id, wx: w.x, wy: w.y, orig: room.pts, plan, moved: false };
    } else {
      setSel(null);
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy };
    }
    schedule();
  }

  function onMove(e) {
    const v = viewRef.current;
    if (!pointers.current.has(e.pointerId)) {
      // no button down: show where a break or corner would go
      const t = toolRef.current;
      if (t === 'break' || t === 'corner') {
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const plan = planRef.current;
        let h = null;
        for (let i = plan.rooms.length - 1; i >= 0 && !h; i -= 1) {
          const room = plan.rooms[i];
          const ed = nearestEdge(room, w.x, w.y, (9 / v.scale) * 1.3);
          if (ed) {
            const q = snapOnEdge(room.pts, ed.i, ed.x, ed.y);
            // the wall's two ends, so the length on each side of the circle can be shown
            h = { x: q.x, y: q.y, kind: t, a: room.pts[ed.i], b: room.pts[(ed.i + 1) % room.pts.length], pts: room.pts };
            const last = lastCornerRef.current;
            if (t === 'corner' && last && last.roomId === room.id && addCornerCut(room, ed.i, ed.x, ed.y, [last.x, last.y]).cut) {
              h.from = { x: last.x, y: last.y }; // the next click would cut the corner between the two
            }
          }
        }
        hoverRef.current = h;
        schedule();
      }
      return;
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (!d) return;

    if (d.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
      const scale = clampN(d.view.scale * (dist / d.dist), 3, 120);
      const w0 = toWorld(d.view, d.cx, d.cy);
      viewRef.current = { scale, ox: cx - w0.x * scale, oy: cy - w0.y * scale };
      schedule();
      return;
    }
    if (pointers.current.size > 1) return;

    const w = toWorld(v, p.x, p.y);
    const free = e.altKey || freeRef.current;
    const tolFt = 10 / v.scale;
    if (d.mode === 'pan') {
      viewRef.current = { ...v, ox: d.ox + (p.x - d.sx), oy: d.oy + (p.y - d.sy) };
    } else if (d.mode === 'room') {
      const x1 = snap(w.x); const y1 = snap(w.y);
      d.draft = { type: 'room', x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
    } else if (d.mode === 'pen' || d.mode === 'water') {
      d.pts.push([w.x, w.y]);
      d.draft = d.mode === 'pen' ? { type: 'pen', color: colorRef.current, pts: d.pts } : { type: 'water', cat: waterRef.current.cat, pts: d.pts };
    } else if (d.mode === 'move-room') {
      d.moved = true;
      // the first corner lands on the grid, so the whole room stays on it
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: translatePts(d.orig, dx, dy) } : r)) };
    } else if (d.mode === 'vertex') {
      d.moved = true;
      const room = d.plan.rooms.find((r) => r.id === d.id);
      const q = free ? { x: snap(w.x), y: snap(w.y) } : snapCorner(planRef.current, w.x, w.y, tolFt, { id: d.id, i: d.i });
      const base = planRef.current.rooms.find((r) => r.id === d.id) || room;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveVertex(base.pts, d.i, q.x, q.y, { free }) } : r)) };
    } else if (d.mode === 'edge') {
      d.moved = true;
      // a wall always slides its ends along the walls beside it, with or without Angles / Alt: only corners move freely
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveEdgeSnapped(d.orig, d.i, w.x - d.wx, w.y - d.wy, { free: false }) } : r)) };
    } else if (d.mode === 'wvertex') {
      d.moved = true;
      const base = planRef.current.water.find((x) => x.id === d.id);
      const q = snapCorner(planRef.current, w.x, w.y, tolFt, null);
      d.plan = { ...d.plan, water: d.plan.water.map((x) => (x.id === d.id ? { ...x, pts: base.pts.map((pt, k) => (k === d.i ? [q.x, q.y] : pt)) } : x)) };
    } else if (d.mode === 'move-water') {
      d.moved = true;
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, water: d.plan.water.map((x) => (x.id === d.id ? { ...x, pts: translatePts(d.orig, dx, dy) } : x)) };
    } else if (d.mode === 'move-mark') {
      d.moved = true;
      const dx = w.x - d.wx; const dy = w.y - d.wy;
      const o = d.orig;
      const moved = o.type === 'pen'
        ? { ...o, pts: o.pts.map((q) => [q[0] + dx, q[1] + dy]) }
        : { ...o, x: o.x + dx, y: o.y + dy };
      d.plan = { ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === d.id ? moved : m)) };
    }
    schedule();
  }

  function onUp(e) {
    const had = pointers.current.has(e.pointerId);
    const p = had ? local(e) : null;
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d || !had) return;

    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) dragRef.current = null; // stay still until all fingers are up
      if (pointers.current.size === 1) {
        // the finger left behind should not start a pan or draw
        const [id] = [...pointers.current.keys()];
        pointers.current.delete(id);
      }
      schedule();
      return;
    }
    dragRef.current = null;
    const plan = planRef.current;

    if (d.mode === 'room') {
      const dr = d.draft;
      if (dr && dr.w >= MIN_ROOM && dr.h >= MIN_ROOM && plan.rooms.length < MAX_ROOMS) {
        const room = { id: makeId(), label: '', notes: '', pts: rectPts(dr.x, dr.y, Math.min(dr.w, MAX_ROOM), Math.min(dr.h, MAX_ROOM)) };
        // the new room takes its space from any room it was drawn over
        const rect = { x: dr.x, y: dr.y, w: Math.min(dr.w, MAX_ROOM), h: Math.min(dr.h, MAX_ROOM) };
        const carved = carveRooms(plan.rooms, rect);
        commit({ ...plan, rooms: [...carved, room] });
        setSel({ kind: 'room', id: room.id });
        setTool('select');
      }
    } else if (d.mode === 'pen') {
      const v = viewRef.current;
      const pts = simplifyStroke(d.pts, 2 / v.scale).map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
      if (plan.marks.length < MAX_MARKS && pts.length) {
        const mark = { id: makeId(), type: 'pen', color: colorRef.current, pts };
        commit({ ...plan, marks: [...plan.marks, mark] });
      }
    } else if (d.mode === 'water') {
      const v = viewRef.current;
      const pts = cleanWater(d.pts, { mode: waterRef.current.mode, eps: Math.max(0.3, 9 / v.scale) });
      if (pts && plan.water.length < MAX_WATER) {
        const water = newWater(pts, waterRef.current.cat, waterRef.current.mode === 'smooth');
        commit({ ...plan, water: [...plan.water, water] });
        setSel({ kind: 'water', id: water.id });
      }
    } else if (d.mode === 'text') {
      if (p && Math.hypot(p.x - d.sx, p.y - d.sy) < 8) setTextDraft({ x: snap(d.wx, 0.25), y: snap(d.wy, 0.25), value: '' });
    } else if (['move-room', 'vertex', 'edge', 'move-mark', 'wvertex', 'move-water'].includes(d.mode) && d.moved && d.plan) {
      let next = d.plan;
      if (d.mode === 'vertex' || d.mode === 'edge') {
        // a corner or wall that now lines up with its neighbours leaves a stray point: drop it
        const room = next.rooms.find((r) => r.id === d.id);
        if (room) {
          const near = d.mode === 'vertex' ? [d.i - 1, d.i, d.i + 1] : [d.i - 1, d.i, d.i + 1, d.i + 2];
          const pts = dropStraightPoints(room.pts, near);
          if (pts.length !== room.pts.length) {
            next = { ...next, rooms: next.rooms.map((r) => (r.id === d.id ? { ...r, pts } : r)) };
            setSel({ kind: 'room', id: d.id });
          }
        }
      }
      commit(normalizePlan(next));
    }
    schedule();
  }

  // Double-click (or double-tap) a corner to remove it.
  function onDoubleClick(e) {
    if (toolRef.current !== 'select') return;
    const r = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const w = toWorld(v, e.clientX - r.left, e.clientY - r.top);
    const tolFt = 12 / v.scale;
    const plan = planRef.current;
    const s = selRef.current;
    const order = [...plan.rooms].sort((a, b) => (b.id === s?.id) - (a.id === s?.id));
    for (const room of order) {
      const vi = nearestVertex(room, w.x, w.y, tolFt);
      if (vi < 0) continue;
      if (room.pts.length > 3) { patchRoom(room.id, { pts: removeVertex(room, vi).pts }); setSel({ kind: 'room', id: room.id }); }
      return;
    }
  }

  function onCancel(e) {
    pointers.current.delete(e.pointerId);
    dragRef.current = null;
    schedule();
  }

  function addText(e) {
    e?.preventDefault();
    const t = textDraft;
    if (!t || !t.value.trim() || planRef.current.marks.length >= MAX_MARKS) { setTextDraft(null); return; }
    const mark = { id: makeId(), type: 'text', color, x: t.x, y: t.y, text: t.value.trim().slice(0, 60) };
    commit({ ...planRef.current, marks: [...planRef.current.marks, mark] });
    setTextDraft(null);
  }

  // ---- keyboard shortcuts ------------------------------------------------
  // V select, H move view, R room, B wall break, C corner, W water, P pen, T text.
  // Delete removes the selection (or the selected corner), Ctrl+Z / Ctrl+Y undo and redo, Esc cancels.
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (inField(e.target)) return;
    const root = rootRef.current;
    const inside = root && root.contains(e.target);
    // from outside the sketch only when nothing else (a photo viewer, a dialog) is on top
    if (!inside && (e.target !== document.body || document.querySelector('.pv-overlay, .popup-overlay, .camera-overlay, .markup-overlay'))) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Escape') {
      if (toolRef.current === 'corner' && lastCornerRef.current) { lastCornerRef.current = null; schedule(); return; } // drop the first click, stay in the tool
      if (dragRef.current) { dragRef.current = null; pointers.current.clear(); }
      setTextDraft(null);
      setTool('select');
      hoverRef.current = null;
      schedule();
      return;
    }
    if (KEYS[k]) { e.preventDefault(); setTool(KEYS[k]); setTextDraft(null); }
  };
  useEffect(() => {
    const h = (e) => keyRef.current?.(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- dimension entry ---------------------------------------------------
  function setDim(which, text) {
    if (!selected || sel.kind !== 'room' || !isRect(selected)) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < MIN_ROOM || ft > MAX_ROOM) { setDimErr(`Enter a size between ${MIN_ROOM} and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    const b = roomBox(selected);
    patchRoom(selected.id, resizeRect(selected, which === 'w' ? ft : b.w, which === 'h' ? ft : b.h));
  }
  function setWallLength(text) {
    if (!selected || sel.kind !== 'room' || sel.ei == null) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < 0.5 || ft > MAX_ROOM) { setDimErr(`Enter a length between 0.5 and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    patchRoom(selected.id, { pts: setEdgeLength(selected.pts, sel.ei, ft) });
  }

  // ---- export ------------------------------------------------------------
  function exportPng() {
    const plan = planRef.current;
    const b = planBounds(plan);
    if (!b) return;
    const W = 1600;
    const H = Math.round(clampN(1600 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 500, 2400));
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const view = fitView(b, W, H, 60);
    drawPlan(ctx, plan, view, { W, H, counts: {}, wet: wetFor(plan), grid: true });
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'sketch'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  const plan = planRef.current;
  const total = totalArea(plan);
  const wet = wetFor(plan);
  const wetTotal = totalWet(wet);
  const room = selected && sel.kind === 'room' ? selected : null;
  const mark = selected && sel.kind === 'mark' ? selected : null;
  const water = selected && sel.kind === 'water' ? selected : null;
  const roomPhotos = room ? photoCounts[room.id] || 0 : 0;
  const rect = room ? isRect(room) : false;
  const box = room ? roomBox(room) : null;
  const wallIdx = room && sel.ei != null && sel.ei < room.pts.length ? sel.ei : null;
  const wallLen = wallIdx != null ? edgeLength(room.pts, wallIdx) : 0;
  const roomWet = room ? wet[room.id] : null;

  return (
    <div className="sketch" ref={rootRef} tabIndex={-1}>
      <div className="sketch-bar">
        <div className="sketch-tools" role="toolbar" aria-label="Sketch tools">
          {TOOLS.map(([k, label, key]) => (
            <button key={k} type="button" className={tool === k ? 'on' : ''} aria-pressed={tool === k} title={`${label} (${key})`} onClick={() => { setTool(k); setTextDraft(null); }}>
              {label}<span className="sk-key">{key}</span>
            </button>
          ))}
          <button type="button" onClick={addRoom} disabled={plan.rooms.length >= MAX_ROOMS}>+ Room</button>
        </div>
        <div className="sketch-tools">
          <button type="button" className={freeAngle ? 'on' : ''} aria-pressed={freeAngle} title="Angles: move corners in any direction instead of keeping square walls square (or hold Alt). Walls always slide along their neighbours." onClick={() => setFreeAngle(!freeAngle)}>Angles</button>
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" onClick={() => zoomCenter(1 / 1.3)} aria-label="Zoom out">-</button>
          <button type="button" onClick={() => zoomCenter(1.3)} aria-label="Zoom in">+</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" onClick={exportPng} disabled={!plan.rooms.length && !plan.marks.length && !plan.water.length}>Save PNG</button>
        </div>
      </div>

      <div className="sketch-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`sketch-canvas tool-${tool}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onDoubleClick={onDoubleClick}
          onPointerLeave={() => { if (hoverRef.current) { hoverRef.current = null; schedule(); } }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Sketch drawing area"
        />
      </div>

      <div className="sketch-summary">
        {plan.rooms.length} room{plan.rooms.length === 1 ? '' : 's'}{plan.rooms.length > 0 && <> · {total.toLocaleString()} sq ft total</>}
        {wetTotal > 0 && <> · <strong className="sk-wet">~{wetTotal.toLocaleString()} sq ft wet</strong></>}
        <span className="muted"> · {HINTS[tool]}</span>
      </div>

      {textDraft && (
        <form className="sketch-panel" onSubmit={addText}>
          <div className="field" style={{ margin: 0, flex: 1 }}>
            <label htmlFor="sk-text">Note text</label>
            <input id="sk-text" autoFocus maxLength={60} value={textDraft.value} onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })} placeholder="Door, wet wall, sump..." />
          </div>
          <button className="primary small">Add</button>
          <button type="button" className="secondary small" onClick={() => setTextDraft(null)}>Cancel</button>
        </form>
      )}

      {tool === 'pen' || tool === 'text' ? (
        <div className="sketch-panel">
          <span className="muted">Color</span>
          <div className="sketch-colors">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
      ) : null}

      {(tool === 'water' || water) && (
        <div className="sketch-panel col">
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="muted">Water</span>
            <div className="chips" role="group" aria-label="Water category">
              {[1, 2, 3].map((c) => (
                <button key={c} type="button" className={(water ? water.cat : waterCat) === c ? 'on' : ''} onClick={() => { setWaterCat(c); if (water) patchWater(water.id, { cat: c }); }}>
                  <span className="sk-dot" style={{ background: WATER_LINE[c] }} />{WATER_CATS[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="muted">Clean up the line</span>
            <div className="chips" role="group" aria-label="Line cleanup">
              {[['smooth', 'Smooth and rounded'], ['straight', 'Straight walls']].map(([m, label]) => (
                <button key={m} type="button" className={(water ? (water.smooth ? 'smooth' : 'straight') : waterMode) === m ? 'on' : ''} onClick={() => { setWaterMode(m); if (water) patchWater(water.id, { smooth: m === 'smooth' }); }}>{label}</button>
              ))}
            </div>
          </div>
          {water && (
            <div className="row" style={{ alignItems: 'center' }}>
              <span className="muted">{Math.round(polyArea(waterOutline(water)))} sq ft covered by this water. Drag its corners to adjust, or the shape to move it.</span>
              <button type="button" className="danger small" onClick={removeSelected}>Delete water</button>
            </div>
          )}
        </div>
      )}

      {room && (
        <div className="sketch-panel col">
          <div className="grid2">
            <div className="field"><label htmlFor="sk-room-name">Room name</label>
              <input id="sk-room-name" key={`${room.id}-l-${room.label}`} defaultValue={room.label} maxLength={40} onBlur={(e) => e.target.value !== room.label && patchRoom(room.id, { label: e.target.value })} placeholder="Kitchen" />
            </div>
            <div className="field"><label htmlFor="sk-room-notes">Notes</label>
              <input id="sk-room-notes" key={`${room.id}-n-${room.notes}`} defaultValue={room.notes} maxLength={300} onBlur={(e) => e.target.value !== room.notes && patchRoom(room.id, { notes: e.target.value })} placeholder="Hardwood, wet along north wall" />
            </div>
          </div>
          <div className="sketch-presets">
            {ROOM_PRESETS.map((p) => <button key={p} type="button" onClick={() => patchRoom(room.id, { label: p })}>{p}</button>)}
          </div>
          {rect ? (
            <div className="grid2">
              <div className="field"><label htmlFor="sk-room-w">Width (feet)</label>
                <input id="sk-room-w" key={`${room.id}-w-${box.w}`} inputMode="decimal" defaultValue={fmtFeet(box.w)} onBlur={(e) => setDim('w', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
              </div>
              <div className="field"><label htmlFor="sk-room-h">Length (feet)</label>
                <input id="sk-room-h" key={`${room.id}-h-${box.h}`} inputMode="decimal" defaultValue={fmtFeet(box.h)} onBlur={(e) => setDim('h', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
              </div>
            </div>
          ) : (
            <div className="muted">{room.pts.length} corners · overall {roomSizeText(room)}. Click a wall to set its length; click a corner to select it.</div>
          )}
          {wallIdx != null && (
            <div className="field" style={{ maxWidth: 260 }}><label htmlFor="sk-wall-len">Selected wall (feet)</label>
              <input id="sk-wall-len" key={`${room.id}-wl-${wallIdx}-${wallLen}`} inputMode="decimal" defaultValue={fmtFeet(wallLen)} onBlur={(e) => setWallLength(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
            </div>
          )}
          {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
          <div className="muted">{roomAreaText(room)}{roomWet && <> · <strong className="sk-wet">~{roomWet.wet} sq ft wet ({WATER_CATS[roomWet.cat]})</strong></>}</div>
          <div className="row">
            {onAddRoomPhoto && <button type="button" className="secondary small" onClick={() => onAddRoomPhoto(room)}>Add photo to this room</button>}
            {onViewRoomPhotos && roomPhotos > 0 && <button type="button" className="secondary small" onClick={() => onViewRoomPhotos(room)}>View photos ({roomPhotos})</button>}
            {rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, resizeRect(room, box.h, box.w))}>Swap width and length</button>}
            {!rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, { pts: tidyPts(room.pts) })}>Tidy corners</button>}
            {sel.vi != null && sel.vi >= 0 && room.pts.length > 3 && <button type="button" className="secondary small" onClick={removeSelected}>Remove this corner</button>}
            <button type="button" className="secondary small" onClick={duplicateRoom}>Duplicate</button>
            <button type="button" className="danger small" onClick={() => { commit({ ...planRef.current, rooms: planRef.current.rooms.filter((r) => r.id !== room.id) }); setSel(null); }}>Delete room</button>
          </div>
        </div>
      )}

      {mark && (
        <div className="sketch-panel">
          {mark.type === 'text' && (
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label htmlFor="sk-mark-text">Note text</label>
              <input id="sk-mark-text" key={mark.id} defaultValue={mark.text} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== mark.text && patchMark(mark.id, { text: e.target.value.trim() })} />
            </div>
          )}
          <div className="sketch-colors">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={mark.color === c ? 'on' : ''} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => patchMark(mark.id, { color: c })} />
            ))}
          </div>
          <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
        </div>
      )}
    </div>
  );
}
