'use client';

export default function AddressFields({ prefix, values, onChange, required }) {
  function set(field, value) { onChange(field, value); }

  return (
    <div>
      <div className="two-col">
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Street address {required ? '*' : ''}</label>
          <input value={values[`${prefix}_street`] || ''} onChange={e => set(`${prefix}_street`, e.target.value)} required={required} />
        </div>
        <div>
          <label>Unit / suite</label>
          <input value={values[`${prefix}_unit`] || ''} onChange={e => set(`${prefix}_unit`, e.target.value)} />
        </div>
        <div>
          <label>City {required ? '*' : ''}</label>
          <input value={values[`${prefix}_city`] || ''} onChange={e => set(`${prefix}_city`, e.target.value)} required={required} />
        </div>
        <div>
          <label>State {required ? '*' : ''}</label>
          <input value={values[`${prefix}_state`] || ''} onChange={e => set(`${prefix}_state`, e.target.value)} required={required} />
        </div>
        <div>
          <label>ZIP {required ? '*' : ''}</label>
          <input value={values[`${prefix}_zip`] || ''} onChange={e => set(`${prefix}_zip`, e.target.value)} required={required} />
        </div>
      </div>
    </div>
  );
}

export function formatAddress(values, prefix) {
  const street = values[`${prefix}_street`] || '';
  const unit = values[`${prefix}_unit`] || '';
  const city = values[`${prefix}_city`] || '';
  const state = values[`${prefix}_state`] || '';
  const zip = values[`${prefix}_zip`] || '';
  const line1 = unit ? `${street}, ${unit}` : street;
  const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
  return [line1, line2].filter(Boolean).join(', ');
}
