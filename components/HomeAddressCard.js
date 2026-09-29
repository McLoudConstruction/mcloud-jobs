'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import MapboxPlaceSearch from './MapboxPlaceSearch';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// Settings card: the signed-in person's home address. The Route Builder's
// "Use home" button fills the Starting location from it.
export default function HomeAddressCard() {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const id = u?.user?.id;
      if (!id) { setLoaded(true); return; }
      const { data, error: err } = await supabase.from('staff_users').select('home_address').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (err) setError('Could not load your home address. Run migration 145 in Supabase first.');
      else { setSaved(data?.home_address || ''); setDraft(data?.home_address || ''); }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(value) {
    setBusy(true); setMsg(''); setError('');
    const { error: err } = await supabase.rpc('set_my_home_address', { new_address: value });
    setBusy(false);
    if (err) { setError(err.message || 'Could not save. Run migration 145 in Supabase first.'); return; }
    setSaved(value.trim());
    setDraft(value.trim());
    setMsg(value.trim() ? 'Home address saved.' : 'Home address cleared.');
  }

  const changed = draft.trim() !== saved.trim();

  return (
    <div className="card">
      <h3>My home address</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Used by the Route Builder. On Sales &gt; Create Sales Route, the &ldquo;Use home&rdquo; button fills the
        Starting location with this address. It belongs to your login only.
      </div>
      {!loaded ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>
      ) : (
        <>
          <label>Home address</label>
          {TOKEN ? (
            <MapboxPlaceSearch
              token={TOKEN}
              placeholder="Start typing your address and pick it"
              proximity={null}
              types="address"
              defaultText={saved}
              allowFreeText
              onPickPlace={p => setDraft([p.street || p.name, p.subtitle].filter(Boolean).join(', '))}
              onPickText={t => setDraft(t)}
              onClear={() => setDraft('')}
            />
          ) : (
            <input value={draft} placeholder="Street, City, State ZIP" onChange={e => setDraft(e.target.value)} />
          )}
          {changed && draft && (
            <div style={{ fontSize: 12.5, marginTop: 8 }}>Will save: <strong>{draft}</strong></div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !changed} onClick={() => save(draft)}>
              {busy ? 'Saving…' : 'Save home address'}
            </button>
            {saved && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => save('')}>Clear</button>
            )}
            {saved && !changed && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Saved: {saved}</span>}
          </div>
          {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: '#16a34a' }}>{msg}</div>}
          {error && <div style={{ fontSize: 12.5, marginTop: 8, color: '#dc2626' }}>{error}</div>}
        </>
      )}
    </div>
  );
}
