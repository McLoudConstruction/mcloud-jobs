// Shared display formatters. Each one is an exact copy of a helper that used to be
// pasted into many files. Screens that need different rounding keep their own version.

// Two decimals, blank value shows a dash. "$1,234.50"
export function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Accepts text such as "$1,234.5" too, and drops the cents on whole dollar amounts. "$1,234" or "$1,234.50"
export function fmtMoneyLoose(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

// "Oct 21, 2026", blank for no date.
export function fmtDateShort(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// "5m ago", "3h ago", "2d ago", then "Oct 21".
export function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Receivable and payable aging column text.
export function agingLabel(days) {
  if (days === null) return '—';
  if (days <= 30) return `${days}d`;
  if (days <= 60) return `${days}d (30+)`;
  if (days <= 90) return `${days}d (60+)`;
  return `${days}d (90+)`;
}
