'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// Shows photos a lead attached to their website Consultation form
// submission (see app/api/public/consultation-request/route.js and
// migration 124). Nothing to show for leads created by staff directly —
// those never have any opportunity_photos rows.
export default function OpportunityPhotosPanel({ opportunityId }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!opportunityId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('opportunity_photos')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('created_at', { ascending: true });

      if (!data || data.length === 0) {
        if (!cancelled) { setPhotos([]); setLoading(false); }
        return;
      }

      const withUrls = await Promise.all(data.map(async p => {
        const { data: signed } = await supabase.storage.from('consultation-photos').createSignedUrl(p.storage_path, 3600);
        return { ...p, url: signed?.signedUrl || null };
      }));

      if (!cancelled) { setPhotos(withUrls.filter(p => p.url)); setLoading(false); }
    }

    load();
    return () => { cancelled = true; };
  }, [opportunityId]);

  if (loading || photos.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <label>Photos from this lead</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {photos.map(p => (
          <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
            <img
              src={p.url}
              alt=""
              style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--panel-line)' }}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
