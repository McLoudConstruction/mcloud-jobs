// The industries McLoud sells to. One list, used wherever a vertical is chosen
// or reported (outreach prospects, website lead attribution, the funnel).
// The keys are stored in the database, so never rename one; change `label`
// instead. The marketing website keeps a matching list in its own repo
// (lib/verticals.js), and the keys must stay in sync between the two.
//
// Properties and sequences store the key as free text (prospect_vertical,
// outreach_sequences.vertical), so values outside this list still work and
// are shown as typed.

export const VERTICALS = [
  { key: 'multi_family', label: 'Multi-Family' },
  { key: 'hotel_lodging', label: 'Hotel & Lodging' },
  { key: 'office', label: 'Office' },
  { key: 'retail', label: 'Retail' },
  { key: 'recreational', label: 'Recreational Facilities' },
  { key: 'church', label: 'Churches' },
  { key: 'residential', label: 'Residential' },
];

export const VERTICAL_KEYS = VERTICALS.map(v => v.key);

const LABEL_BY_KEY = Object.fromEntries(VERTICALS.map(v => [v.key, v.label]));

// Label for a stored key, or the stored text itself when it is not one of ours.
export function verticalLabel(key) {
  if (!key) return '';
  return LABEL_BY_KEY[key] || key;
}
