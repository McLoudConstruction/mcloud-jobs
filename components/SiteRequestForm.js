'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CameraCapture from './CameraCapture';
import { formatPhone } from '../lib/constants';
import {
  loadPropertyForSiteRequest, formatSiteAddress, createSiteRequest, uploadSiteRequestPhotos,
} from '../lib/siteRequests';

// Drive Mode: a customer at this stop asks you to look at something.
// Property details are pulled from the stop's property automatically; you
// add a short description, the project contact, any pertinent details and
// photos. Saves as a Site Request (an opportunities row, migration 146).
const EMPTY = { project: '', contact_name: '', contact_email: '', contact_phone: '', notes: '', existing_contact_id: '' };

export default function SiteRequestForm({ stop, contacts = [], onSaved }) {
  const [property, setProperty] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState([]); // [{ id, file, url }]
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState(null); // request saved, photos may still need retrying
  const fileInputRef = useRef(null);
  const photosRef = useRef([]);
  photosRef.current = photos;

  // Pull the property and pre-fill the contact from it.
  useEffect(() => {
    let cancelled = false;
    loadPropertyForSiteRequest(stop?.property_id).then(({ data }) => {
      if (cancelled) return;
      const p = data || {
        id: stop?.property_id || null,
        property_name: stop?.property_name,
        property_type: stop?.property_type,
        management_company: stop?.management_company,
        property_street: stop?.property_street,
        property_city: stop?.property_city,
        property_state: stop?.property_state,
        property_zip: stop?.property_zip,
      };
      setProperty(p);
      setForm(f => ({
        ...f,
        contact_name: f.contact_name || p.contact_name || '',
        contact_email: f.contact_email || p.contact_email || '',
        contact_phone: f.contact_phone || (p.contact_phone ? formatPhone(p.contact_phone) : ''),
      }));
    });
    return () => { cancelled = true; };
  }, [stop?.property_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { photosRef.current.forEach(p => URL.revokeObjectURL(p.url)); }, []);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function pickContact(id) {
    if (!id) { setForm(f => ({ ...f, existing_contact_id: '' })); return; }
    const c = contacts.find(x => x.id === id);
    if (!c) return;
    setForm(f => ({
      ...f,
      existing_contact_id: c.id,
      contact_name: c.name || '',
      contact_email: c.contact_email || '',
      contact_phone: c.contact_phone ? formatPhone(c.contact_phone) : '',
    }));
  }

  function addPhoto(file) {
    setPhotos(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) }]);
  }
  function removePhoto(id) {
    setPhotos(prev => {
      const hit = prev.find(p => p.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter(p => p.id !== id);
    });
  }
  function handleLibraryFiles(e) {
    Array.from(e.target.files || []).forEach(addPhoto);
    e.target.value = '';
  }

  const address = useMemo(() => formatSiteAddress(property), [property]);
  const canSave = !!form.project.trim() && !!property && !busy;

  async function save() {
    setBusy(true); setError('');
    let id = savedId;
    if (!id) {
      const res = await createSiteRequest({ property, form });
      if (res.error) { setBusy(false); setError(res.error.message || 'Could not save the site request.'); return; }
      id = res.id;
      setSavedId(id);
    }
    const failed = await uploadSiteRequestPhotos(id, photos.map(p => p.file));
    setBusy(false);
    if (failed.length > 0) {
      // Keep only the photos that did not go through so Retry sends just those.
      setPhotos(prev => {
        prev.filter(p => !failed.includes(p.file)).forEach(p => URL.revokeObjectURL(p.url));
        return prev.filter(p => failed.includes(p.file));
      });
      setError(`Site request saved, but ${failed.length} photo${failed.length === 1 ? '' : 's'} did not upload. Check your signal and tap Retry.`);
      return;
    }
    onSaved?.(photos.length);
  }

  return (
    <div style={panelStyle}>
      <div style={propBox}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Pulled from property</div>
        <div style={{ fontWeight: 700, marginTop: 4 }}>{property?.property_name || stop?.property_name || '…'}</div>
        {address && <div style={propLine}>{address}</div>}
        {(property?.property_type || property?.management_company) && (
          <div style={propLine}>{[property.property_type, property.management_company].filter(Boolean).join(' · ')}</div>
        )}
      </div>

      <input
        style={fieldStyle}
        placeholder="What are they asking you to look at?"
        value={form.project}
        maxLength={140}
        onChange={e => set('project', e.target.value)}
        disabled={!!savedId}
      />

      {contacts.length > 0 && !savedId && (
        <select style={fieldStyle} value={form.existing_contact_id} onChange={e => pickContact(e.target.value)}>
          <option value="">Project contact: type below or pick one</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.position ? `, ${c.position}` : ''}</option>)}
        </select>
      )}
      <input style={fieldStyle} placeholder="Project contact name" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} disabled={!!savedId} />
      <input style={fieldStyle} placeholder="Contact email" inputMode="email" type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} disabled={!!savedId} />
      <input style={fieldStyle} placeholder="Contact phone" inputMode="tel" value={form.contact_phone} onChange={e => set('contact_phone', formatPhone(e.target.value))} disabled={!!savedId} />

      <textarea
        style={fieldStyle}
        rows={4}
        placeholder="Pertinent details (scope, timing, access, budget, who decides)"
        value={form.notes}
        onChange={e => set('notes', e.target.value)}
        disabled={!!savedId}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={photoBtn} onClick={() => setCameraOpen(true)}>Take photos</button>
        <button type="button" style={photoBtn} onClick={() => fileInputRef.current?.click()}>From library</button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleLibraryFiles} style={{ display: 'none' }} />
      </div>

      {photos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: 'relative' }}>
              <img src={p.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.28)' }} />
              <button type="button" onClick={() => removePhoto(p.id)} aria-label="Remove photo" style={removeBtn}>×</button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: '#f0a0a0' }}>{error}</div>}

      <button type="button" style={saveBtn} disabled={!canSave} onClick={save}>
        {busy ? 'Saving…' : savedId ? 'Retry photo upload' : 'Save site request'}
      </button>

      {/* Camera must sit above Drive Mode's overlay (z-index 2000); its own
          CSS z-index is lower, so it gets a higher stacking wrapper. */}
      {cameraOpen && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100 }}>
          <CameraCapture open onClose={() => setCameraOpen(false)} onPhotoAccepted={addPhoto} title="Site Request Photos" />
        </div>,
        document.body
      )}
    </div>
  );
}

const panelStyle = { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' };
const propBox = {
  background: 'rgba(155,119,61,0.14)', border: '1px solid rgba(155,119,61,0.5)',
  borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#f3ede0',
};
const propLine = { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 };
const fieldStyle = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.28)',
  color: '#f3ede0', borderRadius: 8, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit',
};
const photoBtn = {
  flex: 1, padding: '11px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 10, color: '#f3ede0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const removeBtn = {
  position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
  background: '#14120f', color: '#f3ede0', border: '1px solid rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1, cursor: 'pointer',
};
const saveBtn = {
  padding: '12px 0', background: '#f3ede0', color: '#14120f', border: 'none', borderRadius: 10,
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
