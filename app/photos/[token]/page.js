'use client';
import { useEffect, useMemo, useState } from 'react';
import PhotoViewer from '../../../components/PhotoViewer';
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

  const items = useMemo(
    () => (data?.photos || []).map(p => ({ key: p.id, thumb: p.url, full: p.url })),
    [data]
  );

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

      <PhotoViewer
        items={items}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onNavigate={setOpenIndex}
        footer={(item) => (
          <a className="btn btn-sm" href={item.full} download target="_blank" rel="noopener noreferrer">Save photo</a>
        )}
      />
    </div>
  );
}
