export const ASSEMBLY_CATEGORIES = [
  { key: 'kitchen', label: 'Kitchen remodel' },
  { key: 'bath', label: 'Bath remodel' },
];
export const ASSEMBLY_TIERS = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
];
export function fmtBand(low, high) {
  const f = v => (v || v === 0) ? Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : null;
  const a = f(low), b = f(high);
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
}
