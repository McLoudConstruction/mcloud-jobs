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

// Signature used to catch "the same property, typed twice" — prefer the
// matched address (so "Oakwood Apts" and "123 Main St" that both resolved
// to the same place still collide), fall back to the raw typed name for
// rows that were never matched to a place.
function stopSignature(row) {
  if (row.place) {
    const addr = [row.place.street, row.place.city, row.place.zip].filter(Boolean).join('|').toLowerCase();
    if (addr) return addr;
  }
  return (row.name || '').trim().toLowerCase();
}

function findDuplicateNames(filled) {
  const seen = new Map();
  const dupNames = new Set();
  filled.forEach(row => {
    const sig = stopSignature(row);
    if (!sig) return;
    if (seen.has(sig)) {
      dupNames.add(seen.get(sig));
      dupNames.add(row.name.trim());
    } else {
      seen.set(sig, row.name.trim());
    }
  });
  return Array.from(dupNames);
}

// The manual counterpart to RouteBuilderCore's AI route — you pick the
// stops yourself instead of having them filtered/sorted for you. Also
// saves to the sales_routes table so a route survives your phone's
// screen going off mid-drive (resumes automatically next time this
// opens), and offers a full-screen "drive mode" for working through
// stops one at a time on a phone.
export default function ManualRouteBuilderCore({ onClose, onRouteChanged }) {
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
  const [dupConfirm, setDupConfirm] = useState(null); // { names, resolve }
  const [optimizing, setOptimizing] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPlace, setEditPlace] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // A promise-based confirm so both "build a new route" and "edit one
  // stop" can pause on the same popup instead of silently allowing (or
  // silently blocking) the same property twice.
  function confirmDuplicates(names) {
    return new Promise(resolve => setDupConfirm({ names, resolve }));
  }

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
    const dupNames = findDuplicateNames(filled);
    if (dupNames.length > 0) {
      const proceed = await confirmDuplicates(dupNames);
      if (!proceed) return;
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
        property_type: p.property_type || null, management_company: p.management_company || null,
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
      if (onRouteChanged) onRouteChanged();
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

  // Re-runs the same straight-line nearest-neighbor ordering used when the
  // route was first built, from wherever you're standing right now.
  // Already-visited stops are left alone (no point reshuffling where
  // you've already been) — only what's left gets reordered.
  async function optimizeRoute() {
    if (!route?.stops?.length) return;
    setOptimizing(true);
    setError('');
    try {
      const start = await getCurrentLocation();
      if (!start) {
        setError('Could not get your current location — enable location access and try again.');
        return;
      }
      const visited = route.stops.filter(s => s.visited_at);
      const unvisited = route.stops.filter(s => !s.visited_at);
      if (unvisited.length === 0) return;
      const reordered = orderStopsForEfficiency(unvisited, start);
      await persistStops([...visited, ...reordered]);
    } finally {
      setOptimizing(false);
    }
  }

  function startEditStop(index) {
    setEditingIndex(index);
    setEditName(route.stops[index].property_name || '');
    setEditPlace(null);
  }
  function cancelEditStop() {
    setEditingIndex(null);
    setEditName('');
    setEditPlace(null);
  }

  // Full replacement of a stop — resolves whatever new property was
  // searched for (creating it if it's not in the database yet, same as
  // the entry form) and swaps it in wholesale, including a fresh
  // (unvisited) status since it's effectively a different stop now.
  async function saveEditStop(index) {
    if (!editName.trim()) return;
    setEditSaving(true);
    setError('');
    try {
      const place = editPlace || {};
      const { property } = await findOrCreatePropertyForRouteStop({
        name: editName, street: place.street, city: place.city, state: place.state, zip: place.zip,
        lat: place.lat, lng: place.lng,
      });
      if (!property) {
        setError('Could not resolve that property.');
        return;
      }
      const dupIndex = route.stops.findIndex((s, i) => i !== index && s.property_id === property.id);
      if (dupIndex !== -1) {
        const proceed = await confirmDuplicates([property.property_name]);
        if (!proceed) return;
      }
      const nextStops = route.stops.map((s, i) => (i === index ? {
        property_id: property.id, property_name: property.property_name,
        property_type: property.property_type || null, management_company: property.management_company || null,
        property_street: property.property_street, property_city: property.property_city,
        property_state: property.property_state, property_zip: property.property_zip,
        property_lat: property.property_lat ?? null, property_lng: property.property_lng ?? null,
        visited_at: null,
      } : s));
      await persistStops(nextStops);
      cancelEditStop();
    } catch (err) {
      setError(err.message);
    } finally {
      setEditSaving(false);
    }
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

  // Undo — for an accidental tap (in the car, on the way to the next
  // stop). Only unmarks this route's own record of the visit; it
  // deliberately doesn't touch the property's last_visited_at, since
  // that field is shared app-wide and this route may not be the only
  // reason it got set.
  async function unmarkStopVisited(index) {
    const stop = route.stops[index];
    if (!stop) return;
    const nextStops = route.stops.map((s, i) => (i === index ? { ...s, visited_at: null } : s));
    await persistStops(nextStops);
  }

  async function handleFinishRoute() {
    if (route?.id) await finishRoute(route.id);
    setDriving(false);
    reset();
    if (onRouteChanged) onRouteChanged();
  }

  async function discardActiveRoute() {
    if (route?.id) await cancelRoute(route.id);
    reset();
    if (onRouteChanged) onRouteChanged();
  }

  function reset() {
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, newRow));
    setEndLocation('');
    setEndPlace(null);
    setRoute(null);
    setError('');
    setDupNote('');
    setEditingIndex(null);
    setEditName('');
    setEditPlace(null);
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
                  {editingIndex === i ? (
                    <div>
                      <PlacesAutocompleteInput
                        value={editName}
                        onChange={setEditName}
                        onPlaceSelected={place => setEditPlace(place)}
                        placeholder="Replace with a different property"
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button type="button" className="btn btn-primary btn-sm" disabled={editSaving} onClick={() => saveEditStop(i)}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={cancelEditStop}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, textDecoration: p.visited_at ? 'line-through' : 'none', opacity: p.visited_at ? 0.6 : 1 }}>{p.property_name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{formatAddress(p) || 'No address on file'}</div>
                    </>
                  )}
                </div>
                {editingIndex !== i && (
                  <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {p.visited_at ? (
                      <button type="button" className="btn btn-sm" onClick={() => unmarkStopVisited(i)}>Undo Visit</button>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => markStopVisited(i)}>Mark Visited</button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => startEditStop(i)}>Edit</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeStop(i)}>Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setDriving(true)}>Start Driving →</button>
            <button className="btn btn-sm" onClick={optimizeRoute} disabled={optimizing}>{optimizing ? 'Optimizing…' : 'Optimize Route'}</button>
            <button className="btn btn-sm" onClick={openInMaps}>Open Full Route in Google Maps</button>
            <button className="btn btn-sm" onClick={markAllVisited} disabled={marking}>{marking ? 'Marking…' : 'Mark All Visited'}</button>
            <button className="btn btn-sm" onClick={handleFinishRoute}>Finish &amp; Start Over</button>
            {onClose && <button className="btn btn-sm" onClick={onClose}>Close (keeps this route saved)</button>}
          </div>
        </div>
      )}

      {dupConfirm && (
        <div style={dupBackdropStyle}>
          <div style={dupBoxStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Duplicate propert{dupConfirm.names.length === 1 ? 'y' : 'ies'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18 }}>
              {dupConfirm.names.join(', ')} {dupConfirm.names.length === 1 ? 'is' : 'are'} already on this route. Add {dupConfirm.names.length === 1 ? 'it' : 'them'} again anyway?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm" onClick={() => { dupConfirm.resolve(false); setDupConfirm(null); }}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { dupConfirm.resolve(true); setDupConfirm(null); }}>Add Anyway</button>
            </div>
          </div>
        </div>
      )}

      {driving && route && (
        <DriveModeOverlay
          stops={route.stops}
          onExit={() => setDriving(false)}
          onMarkVisited={async (index) => { await markStopVisited(index); }}
          onUndoVisit={async (index) => { await unmarkStopVisited(index); }}
          onFinish={handleFinishRoute}
        />
      )}
    </div>
  );
}

const dupBackdropStyle = {
  position: 'fixed', inset: 0, zIndex: 2100,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20,
};
const dupBoxStyle = {
  background: 'var(--card-bg, #fff)', borderRadius: 10, padding: 20,
  maxWidth: 380, width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
};
