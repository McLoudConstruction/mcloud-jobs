'use client';
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

// Opened from a material row in EstimateTab. onSelected receives
// { image_url, image_storage_path, image_source } — the caller persists
// it to job_estimate_items. Search results come from Unsplash via
// /api/material-image-search (public URLs, no signing needed); uploads
// go to the same private job-photos bucket the rest of the app already
// uses, resolved to a signed URL wherever they're displayed.
export default function MaterialImageChooser({ jobId, itemId, onSelected, onClose }) {
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  async function runSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/material-image-search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');
      setResults(data.results || []);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function pickSearchResult(r) {
    onSelected({ image_url: r.fullUrl, image_storage_path: null, image_source: 'search' });
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      // job-photos RLS expects the job id as the first folder segment
      // (see supabase-migration-035) — anything else and a customer's
      // signed-URL read of this file would silently fail.
      const path = `${jobId}/estimate-items/${itemId}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('job-photos').upload(path, file);
      if (uploadErr) throw new Error(uploadErr.message);
      onSelected({ image_url: null, image_storage_path: path, image_source: 'upload' });
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <button style={closeButtonStyle} onClick={onClose}>&times;</button>
        <h3 style={{ marginTop: 0 }}>Choose a material photo</h3>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`btn btn-sm ${mode === 'search' ? 'btn-primary' : ''}`} onClick={() => setMode('search')}>Search photos</button>
          <button className={`btn btn-sm ${mode === 'upload' ? 'btn-primary' : ''}`} onClick={() => setMode('upload')}>Upload my own</button>
        </div>

        {mode === 'search' && (
          <>
            <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input placeholder="e.g. gray berber carpet" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
              <button className="btn btn-sm btn-primary" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </form>
            {searchError && <div style={{ fontSize: 12, color: '#a13f3f', marginBottom: 10 }}>{searchError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => pickSearchResult(r)}
                  title={r.photographer ? `Photo by ${r.photographer} on Unsplash` : ''}
                  style={{ padding: 0, border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: 'none' }}
                >
                  <img src={r.thumbUrl} alt={r.altDescription} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
            {results.length === 0 && !searching && <div className="empty-state">Search for a material to see photos.</div>}
          </>
        )}

        {mode === 'upload' && (
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} disabled={uploading} />
            {uploading && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>Uploading…</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const closeButtonStyle = {
  position: 'absolute', top: 10, right: 14,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 26, lineHeight: 1, color: 'var(--ink-soft)', padding: 4,
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 520,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
  position: 'relative',
};
