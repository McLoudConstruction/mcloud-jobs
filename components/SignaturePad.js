'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

// Bump when the consent wording below changes — it's saved with every
// signature so a later dispute can show exactly which wording was agreed to.
export const SIGNATURE_CONSENT_VERSION = 'v1';
export const SIGNATURE_CONSENT_TEXT =
  'I agree that my printed name and the signature I draw here are my legal signature on this document, and I consent to sign electronically (E-SIGN Act / UETA).';

// Smallest total pen travel (in CSS pixels) that counts as a real signature.
// A single click or a stray tap is a few pixels; even a quick initial is
// well past this. The database can't tell a blank canvas from a real one by
// image size (they overlap), so this is measured here and sent along — see
// migration 132.
const MIN_STROKE_PX = 80;

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SignaturePad({
  label, saved, onSave, saving, defaultName, defaultTitle, note, locked,
  showTitle, requireName, requireTitle, titlePlaceholder, requireConsent,
}) {
  const canvasRef = useRef(null);
  const [name, setName] = useState(saved?.name || defaultName || '');
  const [title, setTitle] = useState(saved?.title || defaultTitle || '');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [strokeOk, setStrokeOk] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const strokeLen = useRef(0);
  const hasDrawnRef = useRef(false);
  const nameEdited = useRef(false);
  const titleEdited = useRef(false);

  // The printed name is part of a legal signature, so it's required unless a
  // caller explicitly opts out — previously several pads (e.g. the owner
  // pad on change orders) let a signature through with no name at all.
  const mustName = requireName !== false;
  const mustConsent = requireConsent !== false;

  // defaultName/defaultTitle can resolve asynchronously after this component
  // has already mounted (e.g. the logged-in staff member's name loading from
  // staff_users right as this page loads). The useState initializer above
  // only runs once, so without this, a late-arriving name is silently
  // dropped and whatever was there at mount time — blank, or a stale
  // fallback — is what gets typed into the signature and saved. Sync in as
  // long as nothing's been signed yet and the person hasn't typed their own
  // value over it.
  useEffect(() => {
    if (saved) return;
    if (!nameEdited.current && defaultName) setName(defaultName);
  }, [defaultName, saved]);
  useEffect(() => {
    if (saved) return;
    if (!titleEdited.current && defaultTitle) setTitle(defaultTitle);
  }, [defaultTitle, saved]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    // Setting width/height resets the context transform, so scale() here
    // is applied exactly once per init.
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#221f16';
  }, []);

  // Size on mount, and again if the pad's width changes (rotating a phone or
  // tablet, opening a side panel) — but only while nothing's been drawn, so
  // a resize never wipes a signature someone's already put down.
  useEffect(() => {
    initCanvas();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = canvas.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const w = canvas.getBoundingClientRect().width;
      if (w !== lastWidth && !hasDrawnRef.current) initCanvas();
      lastWidth = w;
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [initCanvas, saved]);

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
    strokeLen.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    hasDrawnRef.current = true;
    setHasDrawn(true);
    setStrokeOk(strokeLen.current >= MIN_STROKE_PX);
  }
  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    strokeLen.current = 0;
    hasDrawnRef.current = false;
    setHasDrawn(false);
    setStrokeOk(false);
  }
  function save() {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    onSave({
      name: name.trim(),
      title,
      signature: dataUrl,
      date: new Date().toISOString().slice(0, 10),
      // Evidence carried with the signature; the database validates it and
      // writes its own audit row (signature_events) on top of this.
      consent: mustConsent ? true : undefined,
      consent_text_version: mustConsent ? SIGNATURE_CONSENT_VERSION : undefined,
      stroke_length: Math.round(strokeLen.current),
      signed_client_at: new Date().toISOString(),
    });
  }

  const nameMissing = mustName && !name.trim();
  const titleMissing = requireTitle && !title.trim();
  const canSave = hasDrawn && strokeOk && !saving && !nameMissing && !titleMissing && (!mustConsent || agreed);

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
            {saved.signed_at && (
              <div style={{ fontSize: 10, color: '#8b8368' }}>Signed electronically · {fmtDateTime(saved.signed_at)}</div>
            )}
          </div>
          {!locked && <button className="btn btn-sm no-print" style={{ marginTop: 8 }} onClick={() => onSave(null)}>Clear &amp; re-sign</button>}
        </div>
      ) : (
        <div className="sig-editing">
          <input placeholder="Printed name" value={name} onChange={e => { nameEdited.current = true; setName(e.target.value); }} style={{ marginBottom: 8 }} />
          {showTitle && (
            <input placeholder={titlePlaceholder || 'Title (e.g. Property Manager)'} value={title} onChange={e => { titleEdited.current = true; setTitle(e.target.value); }} style={{ marginBottom: 8 }} />
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
          {hasDrawn && !strokeOk && (
            <div style={{ fontSize: 10.5, color: '#a13f3f', marginTop: 6 }}>
              That looks like a tap rather than a signature — please sign across the box.
            </div>
          )}
          {(nameMissing || titleMissing) && (
            <div style={{ fontSize: 10.5, color: '#a13f3f', marginTop: 6 }}>
              {nameMissing ? 'Printed name' : 'Title'} is required before you can submit.
            </div>
          )}
          {mustConsent && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 11, color: '#4a4535', lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width: 'auto', marginTop: 2, flexShrink: 0 }} />
              <span>{SIGNATURE_CONSENT_TEXT}</span>
            </label>
          )}
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
            disabled={!canSave}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      )}
    </div>
  );
}
