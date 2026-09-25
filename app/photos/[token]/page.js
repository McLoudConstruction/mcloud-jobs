'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function PublicPhotoFolderPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    fetch(`/api/public/share/${token}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'This link is not valid.');
        if (body.kind !== 'photo_folder') throw new Error('This link is not valid.');
        setData(body);
      })
      .catch(err => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e) {
      if (e.key === 'Escape') setOpenIndex(null);
      if (e.key === 'ArrowRight') setOpenIndex(i => (i === null ? i : Math.min(i + 1, data.photos.length - 1)));
      if (e.key === 'ArrowLeft') setOpenIndex(i => (i === null ? i : Math.max(i - 1, 0)));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, data]);

  if (error) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-soft)', maxWidth: 480, margin: '0 auto' }}>{error}</div>;
  }
  if (!data) return null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>McLoud Construction</div>
        <h1 style={{ margin: '4px 0 2px', fontSize: 22 }}>{data.folder}</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          {[data.customerName, data.projectAddress].filter(Boolean).join(' — ')}
          {data.photos.length > 0 && ` · ${data.photos.length} photo${data.photos.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {data.photos.length === 0 && <div className="empty-state">No photos in this folder yet — check back soon.</div>}

      <div className="photo-grid">
        {data.photos.map((p, i) => (
          <div className="photo-tile" key={p.id} style={{ cursor: 'pointer' }} onClick={() => setOpenIndex(i)}>
            <img src={p.url} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      {openIndex !== null && data.photos[openIndex] && (
        <div
          onClick={() => setOpenIndex(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={data.photos[openIndex].url}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
          <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <span style={{ color: '#fff', fontSize: 13 }}>{openIndex + 1} / {data.photos.length}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <a className="btn btn-sm" href={data.photos[openIndex].url} download target="_blank" rel="noopener noreferrer">Save</a>
              <button className="btn btn-sm" type="button" onClick={() => setOpenIndex(null)}>Close</button>
            </div>
          </div>
          {openIndex > 0 && (
            <button className="btn btn-sm" type="button" style={{ position: 'absolute', left: 10 }} onClick={e => { e.stopPropagation(); setOpenIndex(openIndex - 1); }}>‹</button>
          )}
          {openIndex < data.photos.length - 1 && (
            <button className="btn btn-sm" type="button" style={{ position: 'absolute', right: 10 }} onClick={e => { e.stopPropagation(); setOpenIndex(openIndex + 1); }}>›</button>
          )}
        </div>
      )}
    </div>
  );
}
