'use client';
import PlacesAutocompleteInput from './PlacesAutocompleteInput';

function fieldName(prefix, suffix) {
  return prefix ? `${prefix}_${suffix}` : suffix;
}

export default function AddressFields({ prefix, values, onChange, required, placesEnabled }) {
  function set(field, value) { onChange(field, value); }

  return (
    <div>
      <div className="two-col">
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Street address {required ? '*' : ''}</label>
          {placesEnabled ? (
            <PlacesAutocompleteInput
              value={values[fieldName(prefix, 'street')] || ''}
              onChange={v => set(fieldName(prefix, 'street'), v)}
              onPlaceSelected={place => {
                set(fieldName(prefix, 'street'), place.street || values[fieldName(prefix, 'street')]);
                if (place.city) set(fieldName(prefix, 'city'), place.city);
                if (place.state) set(fieldName(prefix, 'state'), place.state);
                if (place.zip) set(fieldName(prefix, 'zip'), place.zip);
              }}
              required={required}
            />
          ) : (
            <input value={values[fieldName(prefix, 'street')] || ''} onChange={e => set(fieldName(prefix, 'street'), e.target.value)} required={required} />
          )}
        </div>
        <div>
          <label>Unit / suite</label>
          <input value={values[fieldName(prefix, 'unit')] || ''} onChange={e => set(fieldName(prefix, 'unit'), e.target.value)} />
        </div>
        <div>
          <label>City {required ? '*' : ''}</label>
          <input value={values[fieldName(prefix, 'city')] || ''} onChange={e => set(fieldName(prefix, 'city'), e.target.value)} required={required} />
        </div>
        <div>
          <label>State {required ? '*' : ''}</label>
          <input value={values[fieldName(prefix, 'state')] || ''} onChange={e => set(fieldName(prefix, 'state'), e.target.value)} required={required} />
        </div>
        <div>
          <label>ZIP {required ? '*' : ''}</label>
          <input value={values[fieldName(prefix, 'zip')] || ''} onChange={e => set(fieldName(prefix, 'zip'), e.target.value)} required={required} />
        </div>
      </div>
    </div>
  );
}

export function formatAddress(values, prefix) {
  const street = values[fieldName(prefix, 'street')] || '';
  const unit = values[fieldName(prefix, 'unit')] || '';
  const city = values[fieldName(prefix, 'city')] || '';
  const state = values[fieldName(prefix, 'state')] || '';
  const zip = values[fieldName(prefix, 'zip')] || '';
  const line1 = unit ? `${street}, ${unit}` : street;
  const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
  return [line1, line2].filter(Boolean).join(', ');
}
