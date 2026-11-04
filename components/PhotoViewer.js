'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon } from './photoIcons';

// In-app photo viewer. Fills the screen with the photo at near full
// resolution, steps with arrows, keys or a swipe, and zooms with a real
// pinch (two fingers), a double tap, or the mouse wheel. Zoomed in, one
// finger drags the photo around.
//
// items   [{ key, thumb, full? }]   thumb shows instantly, full replaces it
//         item.resolve() fetches the full-size URL when item.full is not set
//         yet (neighbors are prefetched)
// actions optional array (or (item, index) => array) of
//         { key, label, icon, onClick(item, index), disabled } shown in the
//         top bar. Staff screens pass Markup and Download. Customer and
//         share pages pass nothing.
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

function clampView(v, w, h) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
  if (s <= MIN_SCALE + 0.001) return { s: 1, x: 0, y: 0 };
  const maxX = (w * (s - 1)) / 2;
  const maxY = (h * (s - 1)) / 2;
  return {
    s,
    x: Math.max(-maxX, Math.min(maxX, v.x)),
    y: Math.max(-maxY, Math.min(maxY, v.y)),
  };
}

export default function PhotoViewer({ items, index, onClose, onNavigate, footer, actions }) {
  const open = index !== null && index !== undefined && !!items?.[index];
  const [resolved, setResolved] = useState({}); // key -> url
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [busyAction, setBusyAction] = useState('');
  const stageRef = useRef(null);
  const g = useRef({
    pointers: new Map(),   // pointerId -> { x, y }
    base: null,            // view at the start of a gesture
    startDist: 0,
    startMid: null,
    startPt: null,
    moved: false,
    lastTap: { t: 0, x: 0, y: 0 },
  });
  const viewRef = useRef(view);
  viewRef.current = view;

  const zoomed = view.s > 1.001;
  const count = items?.length || 0;

  const go = useCallback(delta => {
    if (count < 2) return;
    onNavigate((index + delta + count) % count);
  }, [count, index, onNavigate]);

  // New photo: back to fit-to-screen.
  const currentKey = open ? items[index].key : null;
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [currentKey]);

  // Lock page scroll behind the viewer.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go, onClose]);

  // Resolve the full-size URL for this photo and its neighbors.
  useEffect(() => {
    if (!open) return;
    [0, 1, -1].forEach(offset => {
      const item = items[(index + offset + count) % count];
      if (!item || item.full || resolved[item.key] || !item.resolve) return;
      item.resolve().then(url => {
        if (url) setResolved(prev => ({ ...prev, [item.key]: url }));
      }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, items]);

  if (!open) return null;
  const item = items[index];
  const src = item.full || resolved[item.key] || item.thumb;
  const loadingFull = !item.full && !resolved[item.key] && !!item.resolve;
  const actionList = (typeof actions === 'function' ? actions(item, index) : actions) || [];

  // ── Gestures ────────────────────────────────────────────────────────────
  function stageBox() {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, w: r.width, h: r.height } : { left: 0, top: 0, w: 1, h: 1 };
  }
  // Point relative to the middle of the stage (the zoom origin).
  function fromCenter(px, py) {
    const b = stageBox();
    return { x: px - b.left - b.w / 2, y: py - b.top - b.h / 2 };
  }
  function applyView(v) {
    const b = stageBox();
    setView(clampView(v, b.w, b.h));
  }
  function beginGesture() {
    const st = g.current;
    const pts = [...st.pointers.values()];
    st.base = { ...viewRef.current };
    if (pts.length >= 2) {
      const [a, b] = pts;
      st.startDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      st.startMid = fromCenter((a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.length === 1) {
      st.startPt = { x: pts[0].x, y: pts[0].y };
    }
  }

  function onPointerDown(e) {
    if (e.target.closest('.pv-nav, .pv-reset')) return;
    const st = g.current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 1) st.moved = false;
    else st.moved = true; // a second finger is never a tap
    beginGesture();
  }

  function onPointerMove(e) {
    const st = g.current;
    if (!st.pointers.has(e.pointerId)) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...st.pointers.values()];

    if (pts.length >= 2 && st.base) {
      // Pinch: scale by the change in finger distance, keep the point under
      // the fingers in place, and follow the fingers if they drift.
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, st.base.s * (dist / st.startDist)));
      const mid = fromCenter((a.x + b.x) / 2, (a.y + b.y) / 2);
      const qx = (st.startMid.x - st.base.x) / st.base.s;
      const qy = (st.startMid.y - st.base.y) / st.base.s;
      applyView({ s, x: mid.x - s * qx, y: mid.y - s * qy });
      return;
    }

    if (pts.length === 1 && st.startPt && st.base) {
      const dx = pts[0].x - st.startPt.x;
      const dy = pts[0].y - st.startPt.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) st.moved = true;
      if (st.base.s > 1.001) applyView({ s: st.base.s, x: st.base.x + dx, y: st.base.y + dy });
    }
  }

  function onPointerUp(e) {
    const st = g.current;
    if (!st.pointers.has(e.pointerId)) return;
    const last = st.pointers.get(e.pointerId);
    st.pointers.delete(e.pointerId);
    const wasSingle = st.pointers.size === 0 && !!st.startPt && st.base;

    if (wasSingle) {
      const dx = last.x - st.startPt.x;
      const dy = last.y - st.startPt.y;
      const atFit = st.base.s <= 1.001;

      if (atFit && st.moved && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // Swipe to the next or previous photo (only when not zoomed in).
        go(dx < 0 ? 1 : -1);
      } else if (!st.moved) {
        // Tap. Two quick taps toggle zoom around the tapped point.
        const now = Date.now();
        const prev = st.lastTap;
        if (now - prev.t < 320 && Math.hypot(last.x - prev.x, last.y - prev.y) < 30) {
          st.lastTap = { t: 0, x: 0, y: 0 };
          if (viewRef.current.s > 1.001) {
            setView({ s: 1, x: 0, y: 0 });
          } else {
            const p = fromCenter(last.x, last.y);
            applyView({ s: DOUBLE_TAP_SCALE, x: p.x - DOUBLE_TAP_SCALE * p.x, y: p.y - DOUBLE_TAP_SCALE * p.y });
          }
        } else {
          st.lastTap = { t: now, x: last.x, y: last.y };
        }
      }
    }

    if (st.pointers.size === 0) { st.base = null; st.startPt = null; }
    else beginGesture(); // one finger left after a pinch: carry on as a drag
  }

  function onWheel(e) {
    const cur = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0025);
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur.s * factor));
    const p = fromCenter(e.clientX, e.clientY);
    const qx = (p.x - cur.x) / cur.s;
    const qy = (p.y - cur.y) / cur.s;
    applyView({ s, x: p.x - s * qx, y: p.y - s * qy });
  }

  async function runAction(a) {
    if (a.disabled || busyAction) return;
    setBusyAction(a.key);
    try { await a.onClick(item, index); } finally { setBusyAction(''); }
  }

  return (
    <div className="pv-overlay no-print" role="dialog" aria-label="Photo viewer">
      <div className="pv-top">
        <div className="pv-counter">{index + 1} / {count}</div>
        <div className="pv-top-right">
          {actionList.map(a => (
            <button
              key={a.key}
              type="button"
              className="pv-action"
              onClick={() => runAction(a)}
              disabled={a.disabled || !!busyAction}
              aria-label={a.label}
            >
              {a.icon}
              <span>{busyAction === a.key ? 'Working' : a.label}</span>
            </button>
          ))}
          <button type="button" className="pv-close" onClick={onClose} aria-label="Close viewer">
            <CloseIcon size={22} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`pv-stage${zoomed ? ' is-zoomed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img
          key={item.key}
          src={src}
          alt={`Photo ${index + 1} of ${count}`}
          className="pv-img"
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
        {loadingFull && <div className="pv-loading">Loading full size</div>}
        {zoomed && (
          <button type="button" className="pv-reset" onClick={() => setView({ s: 1, x: 0, y: 0 })}>
            Fit to screen
          </button>
        )}
        {count > 1 && !zoomed && (
          <>
            <button type="button" className="pv-nav pv-prev" onClick={() => go(-1)} aria-label="Previous photo">
              <ChevronLeftIcon size={26} />
            </button>
            <button type="button" className="pv-nav pv-next" onClick={() => go(1)} aria-label="Next photo">
              <ChevronRightIcon size={26} />
            </button>
          </>
        )}
      </div>

      {footer && <div className="pv-footer">{typeof footer === 'function' ? footer(item, index) : footer}</div>}
    </div>
  );
}
