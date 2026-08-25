'use client';
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMapsPlaces } from '../lib/googleMapsLoader';

function componentValue(components, type, useShort) {
  const c = (components || []).find(comp => comp.types.includes(type));
  return c ? (useShort ? c.short_name : c.long_name) : '';
}

function parsePlace(place) {
  const components = place.address_components || [];
  const streetNumber = componentValue(components, 'street_number');
  const route = componentValue(components, 'route');
  return {
    name: place.name || '',
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: componentValue(components, 'locality') || componentValue(components, 'sublocality') || componentValue(components, 'administrative_area_level_2'),
    state: componentValue(components, 'administrative_area_level_1', true),
    zip: componentValue(components, 'postal_code'),
  };
}

// Props:
//   value / onChange       — plain text, works exactly like a normal input
//   onPlaceSelected(parsed) — fires only when the user picks a suggestion;
//                             parsed = { name, street, city, state, zip }
// Every other prop passes straight through to the underlying <input>.
export default function PlacesAutocompleteInput({ value, onChange, onPlaceSelected, ...rest }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsPlaces().then(loaded => {
      if (cancelled || !loaded || !inputRef.current || autocompleteRef.current) return;
      setReady(true);
      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        fields: ['address_components', 'name'], // keep this narrow — stays in Google's free Essentials tier
        componentRestrictions: { country: 'us' },
      });
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (!place || !place.address_components) return;
        const parsed = parsePlace(place);
        onChange(parsed.name || inputRef.current.value);
        if (onPlaceSelected) onPlaceSelected(parsed);
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      title={ready ? 'Start typing a name or address — pick a match to auto-fill the rest' : undefined}
      {...rest}
    />
  );
}
