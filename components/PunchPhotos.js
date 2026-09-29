'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { uploadPunchPhotoFile, copyJobPhotoToPunchItem } from '../lib/punchPhotos';

const BUCKET = 'punch-photos';

// Thumbnails for one punch item / warranty claim, plus an "Add photo" button
// when `canAdd`. Used by staff, the customer portal and the sub portal — the
// database decides who may actually see or add (RLS + add_punch_photo), this
// just does the upload: file → {job_id}/{item_id}/… in the private bucket,
// then register it.
export default function PunchPhotos({ item, canAdd = false, allowJobPhotos = false }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jobPhotos, setJobPhotos] = useState([]);
  const [jobUrls, setJobUrls] = useState({});
  const [chosen, setChosen] = useState({});

  const load = useCallback(async () => {
    const { data } = await supabase.from('punch_photos').select('*').eq('item_id', item.id).order('created_at');
    setPhotos(data || []);
    const entries = await Promise.all((data || []).map(async p => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600);
      return [p.id, signed?.signedUrl];
    }));
    setUrls(Object.fromEntries(entries));
  }, [item.id]);

  useEffect(() => { load(); }, [load]);

  // Staff only: choose from what's already on the job's Photos tab.
  async function openPicker() {
    setPickerOpen(true);
    setChosen({});
    const { data } = await supabase.from('job_photos').select('id, storage_path, caption, created_at').eq('job_id', item.job_id).order('created_at', { ascending: false }).limit(60);
    setJobPhotos(data || []);
    const entries = await Promise.all((data || []).map(async p => {
      const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
      return [p.id, signed?.signedUrl];
    }));
    setJobUrls(Object.fromEntries(entries));
  }

  async function addChosen() {
    const picks = jobPhotos.filter(p => chosen[p.id]);
    if (!picks.length) return;
    setBusy(true);
    setError('');
    try {
      for (const p of picks) await copyJobPhotoToPunchItem(item, p);
      setPickerOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'Could not add those photos.');
    }
    setBusy(false);
  }

  async function upload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) await uploadPunchPhotoFile(item, file);
      await load();
    } catch (err) {
      setError(err.message || 'Upload failed.');
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 8 }}>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {photos.map(p => (
            urls[p.id]
              ? <a key={p.id} href={urls[p.id]} target="_blank" rel="noreferrer" title={p.added_by_kind === 'customer' ? 'Added by the customer' : p.added_by_kind === 'sub' ? 'Added by the sub' : 'Added by McLoud'}>
                  <img src={urls[p.id]} alt={p.caption || 'Photo'} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--line)' }} />
                </a>
              : <div key={p.id} style={{ width: 72, height: 72, borderRadius: 5, background: 'var(--panel)' }} />
          ))}
        </div>
      )}
      {canAdd && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple onChange={upload} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Uploading…' : '+ Add photo'}</button>
            {allowJobPhotos && <button type="button" className="btn btn-sm" onClick={openPicker} disabled={busy}>+ From job photos</button>}
          </div>
        </>
      )}
      {pickerOpen && (
        <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 6, padding: 10, background: 'var(--panel)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Pick from this job&apos;s photos</div>
          {jobPhotos.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No photos on this job yet.</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 220, overflowY: 'auto' }}>
            {jobPhotos.map(p => (
              <button key={p.id} type="button" onClick={() => setChosen(c => ({ ...c, [p.id]: !c[p.id] }))}
                style={{ padding: 0, border: chosen[p.id] ? '3px solid var(--accent)' : '3px solid transparent', borderRadius: 6, background: 'none', cursor: 'pointer', width: 76, height: 76, overflow: 'hidden' }}>
                {jobUrls[p.id] ? <img src={jobUrls[p.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </button>
            ))}
          </div>
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !Object.values(chosen).some(Boolean)} onClick={addChosen}>{busy ? 'Adding…' : `Add ${Object.values(chosen).filter(Boolean).length || ''} selected`}</button>
            <button type="button" className="btn btn-sm" onClick={() => setPickerOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
