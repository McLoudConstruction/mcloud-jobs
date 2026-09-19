'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Photo updates feed for Home — merges customer_visible_work_order_photos
// (migration 123, sub progress photos) with customer_visible_job_photos
// (migration 124, any other job photo staff shared — "Share with
// customer" now applies to every photo in the job, not just work-order
// ones). Both only surface photos staff have explicitly marked shareable
// (is_internal = false). Renders nothing at all when there's nothing
// shared yet, same "don't show an empty section" approach as
// PortalFieldProgress.
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
    const [workOrderRes, jobRes] = await Promise.all([
      supabase.from('customer_visible_work_order_photos').select('*').eq('job_id', jobId),
      supabase.from('customer_visible_job_photos').select('*').eq('job_id', jobId),
    ]);
    const merged = [
      ...(workOrderRes.data || []).map(p => ({ ...p, bucket: 'subcontractor-docs' })),
      // job_photos rows carry their own source_bucket (job-photos, or
      // subcontractor-docs for a mirrored sub upload).
      ...(jobRes.data || []).map(p => ({ ...p, bucket: p.source_bucket || 'job-photos' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setPhotos(merged);
    setLoaded(true);
    if (merged.length > 0) {
      const entries = await Promise.all(merged.map(async p => {
        const { data: signed } = await supabase.storage.from(p.bucket).createSignedUrl(p.storage_path, 3600);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos' }, load)
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
              {(p.trade || p.folder) && <span style={{ color: 'var(--heading)', fontWeight: 600 }}>{p.trade || p.folder} · </span>}
              {fmtDate(p.created_at)}
            </div>
            {p.caption && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{p.caption}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}
