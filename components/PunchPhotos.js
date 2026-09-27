'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { compressImage } from '../lib/imageCompress';

const BUCKET = 'punch-photos';

// Thumbnails for one punch item / warranty claim, plus an "Add photo" button
// when `canAdd`. Used by staff, the customer portal and the sub portal — the
// database decides who may actually see or add (RLS + add_punch_photo), this
// just does the upload: file → {job_id}/{item_id}/… in the private bucket,
// then register it.
export default function PunchPhotos({ item, canAdd = false }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

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

  async function upload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.[^.]+$/, '');
        const path = `${item.job_id}/${item.id}/${Date.now()}-${clean}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        const { error: rpcErr } = await supabase.rpc('add_punch_photo', { target_item_id: item.id, path_in: path, caption_in: null });
        if (rpcErr) throw rpcErr;
      }
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
          <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Uploading…' : '+ Add photo'}</button>
        </>
      )}
      {error && <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
