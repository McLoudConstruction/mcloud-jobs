'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPlaces } from '../lib/mapboxRoute';

// Search box for the map Route Builder, ported from the Overlanding Trip
// Planner's PlaceSearch. Suggestions come from Mapbox Search Box; `localMatches`
// lets the parent slot its own results (saved properties) in ahead of them.
//
// Props:
//   token            Mapbox public token
//   placeholder
//   proximity        { lat, lng } to bias results toward, or null
//   types            Mapbox feature types, default 'poi,address'
//   defaultText      externally controlled text (e.g. a chosen start location)
//   clearOnPick      empty the box after a pick (used for "add a stop")
//   allowFreeText    add a last option, "Add <text> as typed", so a place can be
//                    entered by hand even when Mapbox has no match for it
//   onPickText(t)    called with the typed text when that option is chosen
//   localMatches     (lowercased query) => [{ key, label, sub, pick }]
//   onPickPlace(p)   p = { name, street, city, state, zip, lat, lng }
//   onClear()        text was emptied by the user
export default function MapboxPlaceSearch({
  token, placeholder, proximity, types, defaultText, clearOnPick, allowFreeText, localMatches, onPickPlace, onPickText, onClear,
}) {
  const [text, setText] = useState(defaultText || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false); // a search is queued or in flight
  const lastDefault = useRef(defaultText || '');

  // Reflect an externally changed value (a chosen or restored start).
  useEffect(() => {
    if ((defaultText || '') !== lastDefault.current) {
      lastDefault.current = defaultText || '';
      setText(defaultText || '');
    }
  }, [defaultText]);

  const q = text.trim().toLowerCase();

  useEffect(() => {
    if (!token || q.length < 2 || text === lastDefault.current) { setResults([]); setPending(false); return undefined; }
    const ctrl = new AbortController();
    setPending(true);
    const t = setTimeout(async () => {
      const r = await searchPlaces(text, token, proximity, types, ctrl.signal);
      if (!ctrl.signal.aborted) { setResults(r); setActive(0); setPending(false); }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, token]);

  const items = useMemo(() => [
    ...(localMatches && q.length >= 2 ? localMatches(q) : []),
    ...results.map(p => ({
      key: `p-${p.id}`,
      label: p.name,
      sub: p.subtitle,
      pick: () => onPickPlace(p),
    })),
    ...(allowFreeText && onPickText && text.trim().length > 0 ? [{
      key: 'typed',
      label: `Add “${text.trim()}” as typed`,
      sub: 'Uses exactly what you typed. It goes on the route even if it has no map location.',
      pick: () => onPickText(text.trim()),
    }] : []),
  ], [localMatches, q, results, onPickPlace, allowFreeText, onPickText, text]);

  function choose(i) {
    const it = items[i];
    if (!it) return;
    it.pick();
    setOpen(false);
    if (clearOnPick) { setText(''); setResults([]); }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={e => {
          setText(e.target.value);
          setOpen(true);
          if (!e.target.value && onClear) onClear();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (!pending) choose(active); } // wait for suggestions rather than grabbing the typed-text option early
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 50,
            background: 'var(--card-bg, #fff)', border: '1px solid var(--panel-line, var(--line))', borderRadius: 5,
            maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {items.map((it, i) => (
            <div
              key={it.key}
              onMouseDown={e => { e.preventDefault(); choose(i); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)',
                background: i === active ? 'rgba(155,119,61,0.12)' : 'transparent',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
              {it.sub && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{it.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
