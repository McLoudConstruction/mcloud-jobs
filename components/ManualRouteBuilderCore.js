'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PlacesAutocompleteInput from './PlacesAutocompleteInput';
import DriveModeOverlay from './DriveModeOverlay';
import { findOrCreatePropertyForRouteStop } from '../lib/contactSync';
import {
  getActiveRoute, startRoute, updateRouteStops, finishRoute, cancelRoute,
  getCurrentLocation, orderStopsForEfficiency,
} from '../lib/salesRoutes';

const INITIAL_ROW_COUNT = 5;

function newRow() {
  return { key: Math.random().toString(36).slice(2), name: '', place: null };
}

function formatAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

function moveItem(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// The manual counterpart to RouteBuilderCore's AI route — you pick the
// stops yourself instead of having them filtered/sorted for you. Also
// saves to the sales_routes table so a route survives your phone's
// screen going off mid-drive (resumes automatically next time this
// opens), and offers a full-screen "drive mode" for working through
// stops one at a time on a phone.
export default function ManualRouteBuilderCore({ onClose }) {
  const [staffId, setStaffId] = useState(null);
  const [checkingActive, setCheckingActive] = useState(true);
  const [rows, setRows] = useState(() => Array.from({ length: INITIAL_ROW_COUNT }, newRow));
  const [endLocation, setEndLocation] = useState('');
  const [endPlace, setEndPlace] = useState(null);
  const [autoOrder, setAutoOrder] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(null); // the saved sales_routes row once built/resumed
  const [dupNote, setDupNote] = useState('');
  const [marking, setMarking] = useState(false);
  const [driving, setDriving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data?.user?.id || null;
      if (cancelled) return;
      setStaffId(id);
      if (id) {
        const active = await getActiveRoute(id);
        if (!cancelled && active && (active.stops || []).length > 0) setRoute(active);
      }
      if (!cancelled) setCheckingActive(false);
    });
    return () => { cancelled = true; };
  }, []);

  function updateRowName(key, value) {
    setRows(prev => prev.map(r => {
      if (r.key !== key) return r;
      const place = r.place && r.place.name === value ? r.place : null;
      return { ...r, name: value, place };
    }));
  }
  function setRowPlace(key, place) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, name: place.name || r.name, place } : r)));
  }
  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(key) { setRows(prev => (prev.length > 1 ? prev.filter(r => r.key !== key) : prev)); }
  function moveRow(index, direction) { setRows(prev => moveItem(prev, index, direction)); }

  async function buildRoute(e) {
    e.preventDefault();
    const filled = rows.filter(r => r.name.trim());
    if (filled.length === 0) {
      setError('Enter at least one property name.');
      return;
    }
    setLoading(true);
    setError('');
    setDupNote('');
    try {
      const resolved = [];
      let reused = 0;
      for (const row of filled) {
        const place = row.place || {};
        const { property, created } = await findOrCreatePropertyForRouteStop({
          name: row.name, street: place.street, city: place.city, state: place.state, zip: place.zip,
          lat: place.lat, lng: place.lng,
        });
        if (property) {
          resolved.push(property);
          if (!created) reused += 1;
        }
      }
      if (resolved.length === 0) {
        setError('Nothing to route — check the property names above.');
        setLoading(false);
        return;
      }
      if (reused > 0) {
        setDupNote(`${reused} of these ${reused === 1 ? 'was' : 'were'} already in your Property Database — reused instead of creating a duplicate.`);
      }

      let stops = resolved.map(p => ({
        property_id: p.id, property_name: p.property_name,
        property_street: p.property_street, property_city: p.property_city,
        property_state: p.property_state, property_zip: p.property_zip,
        property_lat: p.property_lat ?? null, property_lng: p.property_lng ?? null,
        visited_at: null,
      }));

      let startLabel = null;
      let start = null;
      if (autoOrder) {
        start = await getCurrentLocation();
        if (start) {
          startLabel = 'Your current location';
          stops = orderStopsForEfficiency(stops, start);
        }
      }

      const saved = staffId
        ? await startRoute({
            staffId, startLabel, start,
            endLabel: endPlace?.name || endLocation || null,
            end: endPlace?.lat != null ? { lat: endPlace.lat, lng: endPlace.lng } : null,
            stops, autoOrdered: autoOrder && !!start,
          })
        : { id: null, stops }; // not signed in somehow — still show the built route, just can't save/resume it

      setRoute(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function persistStops(nextStops) {
    setRoute(prev => ({ ...prev, stops: nextStops }));
    if (route?.id) {
      try { await updateRouteStops(route.id, nextStops); } catch (err) { setError(err.message); }
    }
  }

  function moveStop(index, direction) {
    persistStops(moveItem(route.stops, index, direction));
  }
  function removeStop(index) {
    persistStops(route.stops.filter((_, i) => i !== index));
  }

  function openInMaps() {
    const addresses = route.stops.map(p => formatAddress(p)).filter(Boolean);
    if (addresses.length === 0) return;
    const url = `https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`;
    window.open(url, '_blank');
  }

  async function markAllVisited() {
    if (!route?.stops?.length) return;
    setMarking(true);
    const nowIso = new Date().toISOString();
    const ids = route.stops.map(p => p.property_id).filter(Boolean);
    if (ids.length) await supabase.from('properties').update({ last_visited_at: nowIso }).in('id', ids);
    await persistStops(route.stops.map(s => ({ ...s, visited_at: s.visited_at || nowIso })));
    setMarking(false);
  }

  async function markStopVisited(index) {
    const stop = route.stops[index];
    if (!stop) return;
    const nowIso = new Date().toISOString();
    if (stop.property_id) await supabase.from('properties').update({ last_visited_at: nowIso }).eq('id', stop.property_id);
    const nextStops = route.stops.map((s, i) => (i === index ? { ...s, visited_at: nowIso } : s));
    await persistStops(nextStops);
  }

  async function handleFinishRoute() {
    if (route?.id) await finishRoute(route.id);
    setDriving(false);
    reset();
  }

  async function discardActiveRoute() {
    if (route?.id) await cancelRoute(route.id);
    reset();
  }

  function reset() {
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, newRow));
    setEndLocation('');
    setEndPlace(null);
    setRoute(null);
    setError('');
    setDupNote('');
  }

  if (checkingActive) {
    return <div className="card"><h3>Create Sales Route</h3><div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div></div>;
  }

  const resumed = route && route.status === 'active' && route.id && rows.every(r => !r.name.trim());
  const remainingCount = route ? route.stops.filter(s => !s.visited_at).length : 0;

  return (
    <div className="card">
      <h3>Create Sales Route</h3>

      {!route ? (
        <form onSubmit={buildRoute}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
            Type in the properties you want to visit. Start typing a name or address and pick the match to pull in the real address automatically.
          </p>

          {rows.map((row, i) => (
            <div key={row.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 22 }}>
                <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => moveRow(i, -1)} aria-label="Move up" style={{ padding: '2px 8px' }}>↑</button>
                <button type="button" className="btn btn-sm" disabled={i === rows.length - 1} onClick={() => moveRow(i, 1)} aria-label="Move down" style={{ padding: '2px 8px' }}>↓</button>
              </div>
              <div style={{ flex: 1 }}>
                <label>Property {i + 1}</label>
                <PlacesAutocompleteInput
                  value={row.name}
                  onChange={v => updateRowName(row.key, v)}
                  onPlaceSelected={place => setRowPlace(row.key, place)}
                  placeholder="e.g. Oakwood Apartments, or an address"
                />
                {row.place && (
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 }}>
                    {formatAddress({
                      property_street: row.place.street, property_city: row.place.city,
                      property_state: row.place.state, property_zip: row.place.zip,
                    }) || 'Matched, but no street address came back for this result'}
                  </div>
                )}
              </div>
              {rows.length > 1 && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(row.key)} style={{ marginTop: 22 }}>
                  Remove
                </button>
              )}
            </div>
          ))}

          <button type="button" className="btn btn-sm" onClick={addRow}>+ Add another property</button>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', margin: '0 0 10px' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={autoOrder} onChange={e => setAutoOrder(e.target.checked)} />
              Order stops for efficiency, starting from my current location
            </label>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: autoOrder ? 10 : 0 }}>
              A straight-line-distance estimate, not real driving directions — good enough to avoid backtracking across town, not a substitute for a real map. Your browser will ask for location access when you build the route.
            </div>
            {autoOrder && (
              <div>
                <label>End location (optional)</label>
                <PlacesAutocompleteInput
                  value={endLocation}
                  onChange={setEndLocation}
                  onPlaceSelected={place => setEndPlace(place)}
                  placeholder="Where you're headed when the route's done"
                />
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>{loading ? 'Building…' : 'Build Route'}</button>
            {onClose && <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>}
          </div>
        </form>
      ) : (
        <div>
          {resumed && (
            <div style={{ fontSize: 12, color: '#a17c3f', marginBottom: 12 }}>
              Picking up a route already in progress — {remainingCount} of {route.stops.length} stop{route.stops.length === 1 ? '' : 's'} left.{' '}
              <button type="button" className="btn btn-sm" style={{ marginLeft: 6 }} onClick={discardActiveRoute}>Discard &amp; start over</button>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '10px 0 14px' }}>
            {route.stops.length} stop{route.stops.length === 1 ? '' : 's'}{route.auto_ordered ? ', ordered for efficiency from your starting point' : ', in the order you entered them'}.
          </p>
          {dupNote && <div style={{ fontSize: 11.5, color: '#a17c3f', marginBottom: 10 }}>{dupNote}</div>}

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {route.stops.map((p, i) => (
              <div key={p.property_id || i} style={{ display: 'flex', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => moveStop(i, -1)} aria-label="Move up" style={{ padding: '1px 6px', fontSize: 11 }}>↑</button>
                  <button type="button" className="btn btn-sm" disabled={i === route.stops.length - 1} onClick={() => moveStop(i, 1)} aria-label="Move down" style={{ padding: '1px 6px', fontSize: 11 }}>↓</button>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 13, flexShrink: 0, width: 18 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, textDecoration: p.visited_at ? 'line-through' : 'none', opacity: p.visited_at ? 0.6 : 1 }}>{p.property_name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{formatAddress(p) || 'No address on file'}</div>
                </div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeStop(i)} style={{ alignSelf: 'flex-start' }}>Remove</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setDriving(true)}>Start Driving →</button>
            <button className="btn btn-sm" onClick={openInMaps}>Open Full Route in Google Maps</button>
            <button className="btn btn-sm" onClick={markAllVisited} disabled={marking}>{marking ? 'Marking…' : 'Mark All Visited'}</button>
            <button className="btn btn-sm" onClick={handleFinishRoute}>Finish &amp; Start Over</button>
            {onClose && <button className="btn btn-sm" onClick={onClose}>Close (keeps this route saved)</button>}
          </div>
        </div>
      )}

      {driving && route && (
        <DriveModeOverlay
          stops={route.stops}
          onExit={() => setDriving(false)}
          onMarkVisited={async (index) => { await markStopVisited(index); }}
          onFinish={handleFinishRoute}
        />
      )}
    </div>
  );
}
