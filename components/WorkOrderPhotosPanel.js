'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Staff-facing view of a work order's field photos (uploaded by the sub
// from the Sub Portal — see app/sub-portal/work-orders/[workOrderId]/page.js's
// WorkOrderPhotosSection, the only other place these are shown). Every
// photo defaults to is_internal = true (migration 123) — nothing reaches
// the customer portal until staff explicitly flips it here. Lives inline
// in WorkOrdersCard, expanded per work order rather than as its own tab,
// since photos are a detail of one work order, not a job-level list.
function fmtDateTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function WorkOrderPhotosPanel({ workOrderId }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('work_order_photos').select('*').eq('work_order_id', workOrderId).order('created_at', { ascending: false });
    setPhotos(data || []);
    setLoaded(true);
    if (data && data.length > 0) {
      const entries = await Promise.all(data.map(async p => {
        const { data: signed } = await supabase.storage.from('subcontractor-docs').createSignedUrl(p.storage_path, 3600);
        return [p.id, signed?.signedUrl];
      }));
      setUrls(Object.fromEntries(entries));
    }
  }, [workOrderId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`staff-wo-photos-${workOrderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_photos', filter: `work_order_id=eq.${workOrderId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [workOrderId, load]);

  async function toggleShared(photo) {
    setTogglingId(photo.id);
    const { error } = await supabase.from('work_order_photos').update({ is_internal: !photo.is_internal }).eq('id', photo.id);
    setTogglingId(null);
    if (!error) load();
  }

  if (!loaded) return null;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>
        Field Photos {photos.length > 0 && `(${photos.length})`}
      </div>
      {photos.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No photos uploaded yet.</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {photos.map(p => (
          <div key={p.id} style={{ width: 130 }}>
            {urls[p.id] ? (
              <a href={urls[p.id]} target="_blank" rel="noopener noreferrer">
                <img src={urls[p.id]} alt={p.caption || ''} style={{ width: 130, height: 130, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
              </a>
            ) : (
              <div style={{ width: 130, height: 130, background: 'var(--panel)', borderRadius: 6 }} />
            )}
            <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 4 }}>{fmtDateTime(p.created_at)}</div>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                width: '100%', marginTop: 4, fontSize: 10.5, padding: '4px 6px',
                color: p.is_internal ? undefined : 'var(--money)',
                borderColor: p.is_internal ? undefined : 'var(--money)',
              }}
              onClick={() => toggleShared(p)}
              disabled={togglingId === p.id}
            >
              {togglingId === p.id ? '…' : p.is_internal ? 'Share with customer' : '✓ Shared with customer'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
