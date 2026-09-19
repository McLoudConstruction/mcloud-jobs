'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Photo updates feed for Home — reads customer_visible_work_order_photos
// (migration 123), which only surfaces photos staff have explicitly
// marked shareable (is_internal = false). Renders nothing at all when
// there's nothing shared yet, same "don't show an empty section" approach
// as PortalFieldProgress.
function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PortalPhotoFeed({ jobId }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!jobId) return;
    const { data } = await supabase
      .from('customer_visible_work_order_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    setPhotos(data || []);
    setLoaded(true);
    if (data && data.length > 0) {
      const entries = await Promise.all(data.map(async p => {
        const { data: signed } = await supabase.storage.from('subcontractor-docs').createSignedUrl(p.storage_path, 3600);
        return [p.id, signed?.signedUrl];
      }));
      setUrls(Object.fromEntries(entries));
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    load();
    const channel = supabase.channel(`portal-photos-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_photos' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  if (!jobId || !loaded || photos.length === 0) return null;

  return (
    <div className="dash-section">
      <h3>Photo Updates</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {photos.map(p => (
          <a key={p.id} href={urls[p.id] || '#'} target="_blank" rel="noopener noreferrer" style={{ width: 140 }}>
            {urls[p.id] ? (
              <img src={urls[p.id]} alt={p.caption || p.trade || ''} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            ) : (
              <div style={{ width: 140, height: 140, background: 'var(--panel)', borderRadius: 6 }} />
            )}
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
              {p.trade && <span style={{ color: 'var(--heading)', fontWeight: 600 }}>{p.trade} · </span>}
              {fmtDate(p.created_at)}
            </div>
            {p.caption && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{p.caption}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}
