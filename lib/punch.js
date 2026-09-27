// Labels and colours for punch items and warranty claims (migration 137).

export const PUNCH_STATUS = {
  open: { label: 'Open', color: '#a17c3f', bg: '#f7efdc' },
  in_progress: { label: 'In progress', color: '#2f4858', bg: '#e6edf1' },
  resolved: { label: 'Fixed — awaiting confirmation', color: '#3a6b45', bg: '#e7f1e9' },
  verified: { label: 'Confirmed', color: '#3a6b45', bg: '#e7f1e9' },
  declined: { label: 'Declined', color: '#a13f3f', bg: '#fbeae7' },
};

export const PUNCH_STATUS_ORDER = ['open', 'in_progress', 'resolved', 'verified', 'declined'];

// "Open" for the purposes of holding a review request, closing out a job, etc.
export const PUNCH_OPEN_STATUSES = ['open', 'in_progress', 'resolved'];

export function fmtPunchDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
