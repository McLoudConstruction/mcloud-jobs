'use client';
import { useState, useRef, useEffect } from 'react';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SignaturePad({ label, saved, onSave, saving, defaultName, defaultTitle, note, locked, showTitle, requireName, requireTitle }) {
  const canvasRef = useRef(null);
  const [name, setName] = useState(saved?.name || defaultName || '');
  const [title, setTitle] = useState(saved?.title || defaultTitle || '');
  const [hasDrawn, setHasDrawn] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#221f16';
  }, []);

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }
  function start(e) { e.preventDefault(); drawing.current = true; last.current = getPos(e); }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function end() { if (drawing.current) { drawing.current = false; setHasDrawn(true); } }
  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }
  function save() {
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSave({ name, title, signature: dataUrl, date: new Date().toISOString().slice(0, 10) });
  }

  return (
    <div>
      <h4 style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9b773d', margin: '0 0 10px' }}>{label}</h4>

      {saved?.signature ? (
        <div>
          <div style={{ height: 70, borderBottom: '1.5px solid #221f16', display: 'flex', alignItems: 'flex-end', paddingBottom: 4, marginBottom: 6 }}>
            <img src={saved.signature} alt={`${label} signature`} style={{ maxHeight: 64, maxWidth: '100%' }} />
          </div>
          <div style={{ fontSize: 11.5, color: '#221f16', lineHeight: 1.7 }}>
            {saved.name || 'Printed name'}{saved.title ? `, ${saved.title}` : ''}<br />
            Date: {fmtDate(saved.date)}
          </div>
          {!locked && <button className="btn btn-sm no-print" style={{ marginTop: 8 }} onClick={() => onSave(null)}>Clear &amp; re-sign</button>}
        </div>
      ) : (
        <div className="sig-editing">
          <input placeholder="Printed name" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 8 }} />
          {showTitle && (
            <input placeholder="Title (e.g. Property Manager)" value={title} onChange={e => setTitle(e.target.value)} style={{ marginBottom: 8 }} />
          )}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: 110, background: '#fbf9f4', border: '1px solid #c4c1a6', borderRadius: 5, touchAction: 'none', display: 'block' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 10.5, color: '#8b8368' }}>{note || 'Draw signature above'}</span>
            <button className="btn btn-sm" onClick={clearPad}>Clear</button>
          </div>
          {((requireName && !name.trim()) || (requireTitle && !title.trim())) && (
            <div style={{ fontSize: 10.5, color: '#a13f3f', marginTop: 6 }}>
              {requireName && !name.trim() ? 'Name' : 'Title'} is required before you can submit.
            </div>
          )}
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
            disabled={!hasDrawn || saving || (requireName && !name.trim()) || (requireTitle && !title.trim())}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      )}
    </div>
  );
}
