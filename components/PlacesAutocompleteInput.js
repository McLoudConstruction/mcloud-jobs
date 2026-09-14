'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadGoogleMapsPlaces } from '../lib/googleMapsLoader';

// Google discontinued the old google.maps.places.Autocomplete widget for
// any account new to Places API since March 1, 2025 — it no longer runs
// at all (see lib/googleMapsLoader.js). Google's own suggested
// replacement, PlaceAutocompleteElement, is a closed-shadow-DOM custom
// element with its own built-in input — it can't be dropped into this
// app's existing styled <input> the way the old widget could, and
// wrapping it in a way that matched this app's look everywhere would be
// a bigger, riskier change than fixing the actual gap here (address
// lookup not working at all).
//
// So this uses the other non-deprecated half of the new Places API
// instead: AutocompleteSuggestion.fetchAutocompleteSuggestions(), the
// plain data call the widget itself is built on. That means this stays
// a genuine plain <input> — same styling as every other field in the
// app — with a small self-built dropdown underneath it, same pattern
// this app already uses for the Contact Name suggestions on the Sales
// page (app/sales/page.js).
const DEBOUNCE_MS = 250;

let placesLib = null; // { AutocompleteSuggestion, AutocompleteSessionToken } — resolved once, reused everywhere

async function getPlacesLib() {
  if (placesLib) return placesLib;
  placesLib = await window.google.maps.importLibrary('places');
  return placesLib;
}

function textOf(field) {
  if (!field) return '';
  return typeof field === 'string' ? field : (field.text || '');
}

function componentValue(components, type, useShort) {
  const c = (components || []).find(comp => (comp.types || []).includes(type));
  if (!c) return '';
  return useShort ? (c.shortText || c.longText || '') : (c.longText || c.shortText || '');
}

async function parsePlace(place) {
  // location is still Basic Data (same free tier as the rest) — lets
  // saved stops carry coordinates for the Sales Route builder's
  // straight-line ordering estimate without a separate geocoding call.
  await place.fetchFields({ fields: ['addressComponents', 'displayName', 'location'] });
  const components = place.addressComponents || [];
  const streetNumber = componentValue(components, 'street_number');
  const route = componentValue(components, 'route');
  return {
    name: textOf(place.displayName),
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: componentValue(components, 'locality') || componentValue(components, 'sublocality') || componentValue(components, 'administrative_area_level_2'),
    state: componentValue(components, 'administrative_area_level_1', true),
    zip: componentValue(components, 'postal_code'),
    lat: typeof place.location?.lat === 'function' ? place.location.lat() : (place.location?.lat ?? null),
    lng: typeof place.location?.lng === 'function' ? place.location.lng() : (place.location?.lng ?? null),
  };
}

// Props:
//   value / onChange       — plain text, works exactly like a normal input
//   onPlaceSelected(parsed) — fires only when the user picks a suggestion;
//                             parsed = { name, street, city, state, zip }
// Every other prop passes straight through to the underlying <input>.
export default function PlacesAutocompleteInput({ value, onChange, onPlaceSelected, ...rest }) {
  const [ready, setReady] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);
  const sessionTokenRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsPlaces().then(loaded => {
      if (!cancelled) setReady(loaded);
    });
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, []);

  // The dropdown is portaled to <body> and positioned by fixed coordinates
  // rather than being an absolutely-positioned child, because several
  // places this field is used (the built-route stop list, in particular)
  // sit inside a scrollable, overflow-clipped container — an absolutely
  // positioned child gets cut off at that container's edge instead of
  // floating over the rest of the page.
  function updateDropdownRect() {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
  }

  useEffect(() => {
    if (!showSuggestions) return;
    updateDropdownRect();
    const handler = () => updateDropdownRect();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [showSuggestions]);

  async function fetchSuggestions(text) {
    const requestId = ++requestIdRef.current;
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await getPlacesLib();
      if (!sessionTokenRef.current) sessionTokenRef.current = new AutocompleteSessionToken();
      const { suggestions: results } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        includedRegionCodes: ['us'],
        sessionToken: sessionTokenRef.current,
      });
      if (requestId !== requestIdRef.current) return; // a newer keystroke already superseded this request
      const withPlaces = (results || []).filter(s => s.placePrediction);
      setSuggestions(withPlaces);
      setShowSuggestions(withPlaces.length > 0);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    if (!ready) return;
    clearTimeout(debounceRef.current);
    if (!text.trim()) {
      requestIdRef.current++; // cancel any in-flight request — an empty field has nothing to suggest
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
  }

  async function selectSuggestion(suggestion) {
    setShowSuggestions(false);
    setSuggestions([]);
    try {
      const place = suggestion.placePrediction.toPlace();
      const parsed = await parsePlace(place);
      onChange(parsed.name || value);
      if (onPlaceSelected) onPlaceSelected(parsed);
    } finally {
      sessionTokenRef.current = null; // a session ends once a place is selected — the next search starts fresh
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        autoComplete="off"
        title={ready ? 'Start typing a name or address — pick a match to auto-fill the rest' : undefined}
        {...rest}
      />
      {showSuggestions && dropdownRect && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed', top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width,
            zIndex: 4000, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5,
            maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const main = textOf(pred.mainText) || textOf(pred.text);
            const secondary = textOf(pred.secondaryText);
            return (
              <div
                key={pred.placeId || i}
                onMouseDown={() => selectSuggestion(s)}
                style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
              >
                <div style={{ fontWeight: 600 }}>{main}</div>
                {secondary && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{secondary}</div>}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
