'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PlacesAutocompleteInput from './PlacesAutocompleteInput';
import { findOrCreatePropertyForRouteStop } from '../lib/contactSync';

const INITIAL_ROW_COUNT = 5;

function newRow() {
  return { key: Math.random().toString(36).slice(2), name: '', place: null };
}

function formatAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

// The manual counterpart to RouteBuilderCore's AI route — you pick the
// stops yourself instead of having them filtered/sorted for you. No
// modal/portal chrome of its own, same as RouteBuilderCore, so it can
// drop into a popup on Dashboard or Sales the same way.
export default function ManualRouteBuilderCore({ onClose }) {
  const [rows, setRows] = useState(() => Array.from({ length: INITIAL_ROW_COUNT }, newRow));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(null);
  const [dupNote, setDupNote] = useState('');
  const [marking, setMarking] = useState(false);

  function updateRowName(key, value) {
    setRows(prev => prev.map(r => {
      if (r.key !== key) return r;
      // A place only stays attached to a row if the text still matches what
      // was picked — otherwise a stale address would follow edited text.
      const place = r.place && r.place.name === value ? r.place : null;
      return { ...r, name: value, place };
    }));
  }
  function setRowPlace(key, place) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, name: place.name || r.name, place } : r)));
  }
  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(key) { setRows(prev => (prev.length > 1 ? prev.filter(r => r.key !== key) : prev)); }

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
      const stops = [];
      let reused = 0;
      for (const row of filled) {
        const place = row.place || {};
        const { property, created } = await findOrCreatePropertyForRouteStop({
          name: row.name,
          street: place.street,
          city: place.city,
          state: place.state,
          zip: place.zip,
        });
        if (property) {
          stops.push(property);
          if (!created) reused += 1;
        }
      }
      if (stops.length === 0) {
        setError('Nothing to route — check the property names above.');
        setLoading(false);
        return;
      }
      if (reused > 0) {
        setDupNote(`${reused} of these ${reused === 1 ? 'was' : 'were'} already in your Property Database — reused instead of creating a duplicate.`);
      }
      setRoute(stops);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openInMaps() {
    const addresses = route.map(p => formatAddress(p)).filter(Boolean);
    if (addresses.length === 0) return;
    const url = `https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`;
    window.open(url, '_blank');
  }

  async function markAllVisited() {
    if (!route || route.length === 0) return;
    setMarking(true);
    await supabase.from('properties').update({ last_visited_at: new Date().toISOString() }).in('id', route.map(p => p.id));
    setMarking(false);
  }

  function reset() {
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, newRow));
    setRoute(null);
    setError('');
    setDupNote('');
  }

  return (
    <div className="card">
      <h3>Create Sales Route</h3>

      {!route ? (
        <form onSubmit={buildRoute}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
            Type in the properties you want to visit, in the order you want to visit them. Start typing a name or address and pick the match to pull in the real address automatically.
          </p>

          {rows.map((row, i) => (
            <div key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
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

          {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>{loading ? 'Building…' : 'Build Route'}</button>
            {onClose && <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>}
          </div>
        </form>
      ) : (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '10px 0 14px' }}>
            {route.length} stop{route.length === 1 ? '' : 's'}, in the order you entered them.
          </p>
          {dupNote && <div style={{ fontSize: 11.5, color: '#a17c3f', marginBottom: 10 }}>{dupNote}</div>}

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {route.map((p, i) => (
              <RouteStopRow key={p.id} index={i + 1} p={p} />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={openInMaps}>Open Route in Google Maps</button>
            <button className="btn btn-sm" onClick={markAllVisited} disabled={marking}>{marking ? 'Marking…' : 'Mark All Visited'}</button>
            <button className="btn btn-sm" onClick={reset}>Start Over</button>
            {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function RouteStopRow({ index, p }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 13, flexShrink: 0, width: 20 }}>{index}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.property_name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{formatAddress(p) || 'No address on file'}</div>
      </div>
    </div>
  );
}
