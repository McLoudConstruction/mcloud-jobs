'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const COLORS = [
  { name: 'Neon Green', value: '#39FF14' },
  { name: 'Orange', value: '#FF7A00' },
  { name: 'Red', value: '#FF3B30' },
  { name: 'Blue', value: '#2D7FF9' },
  { name: 'White', value: '#FFFFFF' },
];
const TOOLS = ['rectangle', 'circle', 'arrow', 'text'];
const TOOL_LABELS = { rectangle: 'Rectangle', circle: 'Circle', arrow: 'Arrow', text: 'Text' };
const MAX_CANVAS_DIMENSION = 1600;
const LINE_WIDTH_RATIO = 0.006; // relative to canvas width, so strokes scale with photo size

export default function PhotoMarkupEditor({ imageUrl, onSave, onClose }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState('rectangle');
  const [color, setColor] = useState(COLORS[0].value);
  const [annotations, setAnnotations] = useState([]);
  const [drawing, setDrawing] = useState(null); // in-progress shape while dragging
  const [textPrompt, setTextPrompt] = useState(null); // { x, y } in canvas coords, awaiting text input
  const [textValue, setTextValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Load the source photo once, size the canvas to it (capped), draw the base image.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(img.width, img.height));
      const canvas = canvasRef.current;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      imgRef.current = img;
      setReady(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const redraw = useCallback((liveShape) => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

    const lineWidth = Math.max(2, canvas.width * LINE_WIDTH_RATIO);
    const allShapes = liveShape ? [...annotations, liveShape] : annotations;
    for (const a of allShapes) drawAnnotation(ctx, a, lineWidth);
  }, [annotations]);

  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  function drawAnnotation(ctx, a, lineWidth) {
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (a.type === 'rectangle') {
      ctx.strokeRect(a.x, a.y, a.w, a.h);
    } else if (a.type === 'circle') {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.type === 'arrow') {
      drawArrow(ctx, a.x, a.y, a.x + a.w, a.y + a.h, lineWidth);
    } else if (a.type === 'text') {
      const fontSize = Math.max(16, ctx.canvas.width * 0.035);
      ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = fontSize * 0.12;
      ctx.strokeText(a.text, a.x, a.y);
      ctx.fillText(a.text, a.x, a.y);
    }
  }

  function drawArrow(ctx, x1, y1, x2, y2, lineWidth) {
    const headLength = Math.max(12, lineWidth * 5);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function getCanvasPoint(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e) {
    if (!ready) return;
    const pt = getCanvasPoint(e);
    if (tool === 'text') {
      setTextPrompt(pt);
      setTextValue('');
      return;
    }
    setDrawing({ type: tool, x: pt.x, y: pt.y, w: 0, h: 0, color });
  }

  function handlePointerMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const pt = getCanvasPoint(e);
    const updated = { ...drawing, w: pt.x - drawing.x, h: pt.y - drawing.y };
    setDrawing(updated);
    redraw(updated);
  }

  function handlePointerUp() {
    if (!drawing) return;
    if (Math.abs(drawing.w) > 4 || Math.abs(drawing.h) > 4) {
      setAnnotations(prev => [...prev, drawing]);
    }
    setDrawing(null);
  }

  function commitText() {
    if (textValue.trim()) {
      setAnnotations(prev => [...prev, { type: 'text', x: textPrompt.x, y: textPrompt.y, text: textValue.trim(), color }]);
    }
    setTextPrompt(null);
    setTextValue('');
  }

  function undo() {
    setAnnotations(prev => prev.slice(0, -1));
  }

  async function handleSave() {
    setSaving(true);
    canvasRef.current.toBlob(blob => {
      onSave(blob);
      setSaving(false);
    }, 'image/jpeg', 0.88);
  }

  return (
    <div className="markup-overlay">
      <div className="markup-toolbar">
        <div className="markup-tools">
          {TOOLS.map(t => (
            <button key={t} className={`markup-tool-btn ${tool === t ? 'active' : ''}`} onClick={() => setTool(t)}>
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="markup-colors">
          {COLORS.map(c => (
            <button
              key={c.value}
              className={`markup-swatch ${color === c.value ? 'active' : ''}`}
              style={{ background: c.value }}
              title={c.name}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>
        <div className="markup-actions">
          <button className="btn btn-sm" onClick={undo} disabled={annotations.length === 0}>Undo</button>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !ready}>
            {saving ? 'Saving…' : 'Save Markup'}
          </button>
        </div>
      </div>

      <div className="markup-canvas-wrap" ref={containerRef}>
        {!ready && <div className="empty-state">Loading photo…</div>}
        <canvas
          ref={canvasRef}
          className="markup-canvas"
          style={{ display: ready ? 'block' : 'none' }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
        {textPrompt && (
          <div className="markup-text-input-wrap" style={{ left: `${(textPrompt.x / canvasRef.current.width) * 100}%`, top: `${(textPrompt.y / canvasRef.current.height) * 100}%` }}>
            <input
              autoFocus
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextPrompt(null); }}
              onBlur={commitText}
              placeholder="Type label…"
              style={{ color, borderColor: color }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
