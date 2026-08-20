'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';
import { PROPERTY_TYPES } from '../lib/constants';

const DEFAULT_AVOID_DAYS = 14;

function formatAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function RouteBuilderModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [area, setArea] = useState('');
  const [stops, setStops] = useState('10');
  const [avoidDays, setAvoidDays] = useState(String(DEFAULT_AVOID_DAYS));
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  async function buildRoute(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setRoute(null);
    try {
      let query = supabase.from('properties').select('*').not('prospect_stage', 'in', '("won","lost")');
      if (types.length > 0) query = query.in('property_type', types);
      const { data, error: qError } = await query;
      if (qError) throw qError;

      const term = area.trim().toLowerCase();
      const matched = (data || []).filter(p => {
        if (!term) return true;
        return (p.property_zip || '').toLowerCase().includes(term) || (p.property_city || '').toLowerCase().includes(term);
      }).filter(p => p.property_street);

      const cutoffMs = Date.now() - Number(avoidDays || DEFAULT_AVOID_DAYS) * 24 * 60 * 60 * 1000;
      const fresh = matched.filter(p => !p.last_visited_at || new Date(p.last_visited_at).getTime() < cutoffMs);
      const recent = matched.filter(p => p.last_visited_at && new Date(p.last_visited_at).getTime() >= cutoffMs);

      function sortForRoute(list) {
        return list.slice().sort((a, b) => {
          const zipCompare = (a.property_zip || '').localeCompare(b.property_zip || '');
          if (zipCompare !== 0) return zipCompare;
          return (a.property_street || '').localeCompare(b.property_street || '');
        });
      }

      const stopCount = Math.max(1, parseInt(stops, 10) || 10);
      const sortedFresh = sortForRoute(fresh).slice(0, stopCount);
      const remaining = stopCount - sortedFresh.length;
      const sortedRecent = recent.slice().sort((a, b) => new Date(a.last_visited_at) - new Date(b.last_visited_at)).slice(0, Math.max(0, remaining));

      if (sortedFresh.length === 0 && sortedRecent.length === 0) {
        setError('No matching properties found — try a broader area or fewer property type filters.');
        setLoading(false);
        return;
      }

      setRoute({ fresh: sortedFresh, filler: sortedRecent });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openInMaps() {
    const stopsList = [...(route.fresh || []), ...(route.filler || [])];
    const addresses = stopsList.map(p => formatAddress(p)).filter(Boolean);
    if (addresses.length === 0) return;
    const url = `https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`;
    window.open(url, '_blank');
  }

  async function markAllVisited() {
    const stopsList = [...(route.fresh || []), ...(route.filler || [])];
    if (stopsList.length === 0) return;
    setMarking(true);
    await supabase.from('properties').update({ last_visited_at: new Date().toISOString() }).in('id', stopsList.map(p => p.id));
    setMarking(false);
  }

  function handleClose() {
    setArea('');
    setStops('10');
    setTypes([]);
    setRoute(null);
    setError('');
    onClose();
  }

  return createPortal(
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Create My Sales Route</h3>

        {!route ? (
          <form onSubmit={buildRoute}>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
              Tell me where you're working and what you're looking for, and I'll put together a route — automatically working around anything you've visited recently.
            </p>

            <label>ZIP code or area</label>
            <input value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. 64133 or Raytown" />

            <div className="two-col" style={{ marginTop: 12 }}>
              <div>
                <label>Number of stops</label>
                <input type="number" min="1" value={stops} onChange={e => setStops(e.target.value)} />
              </div>
              <div>
                <label>Avoid properties visited within</label>
                <select value={avoidDays} onChange={e => setAvoidDays(e.target.value)}>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                </select>
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Property types to include</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
              {PROPERTY_TYPES.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={types.includes(t)} onChange={() => toggleType(t)} />
                  {t}
                </label>
              ))}
            </div>

            {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>{loading ? 'Building…' : 'Build Route'}</button>
              <button className="btn btn-sm" type="button" onClick={handleClose}>Cancel</button>
            </div>
          </form>
        ) : (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '10px 0 14px' }}>
              {route.fresh.length + route.filler.length} stop{route.fresh.length + route.filler.length === 1 ? '' : 's'}, grouped by ZIP for a sensible driving order.
            </p>

            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {route.fresh.map((p, i) => (
                <RouteStopRow key={p.id} index={i + 1} p={p} />
              ))}
              {route.filler.map((p, i) => (
                <RouteStopRow key={p.id} index={route.fresh.length + i + 1} p={p} recent />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={openInMaps}>Open Route in Google Maps</button>
              <button className="btn btn-sm" onClick={markAllVisited} disabled={marking}>{marking ? 'Marking…' : 'Mark All Visited'}</button>
              <button className="btn btn-sm" onClick={() => setRoute(null)}>Start Over</button>
              <button className="btn btn-sm" onClick={handleClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function RouteStopRow({ index, p, recent }) {
  const daysSinceVisit = daysAgo(p.last_visited_at);
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 13, flexShrink: 0, width: 20 }}>{index}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.property_name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{formatAddress(p)}</div>
        {recent && (
          <div style={{ fontSize: 11, color: '#a17c3f', marginTop: 2 }}>
            Recently visited ({daysSinceVisit}d ago) — included to fill your stop count
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 480,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
};
