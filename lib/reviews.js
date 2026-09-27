// Shared labels for the review system (migration 138). The database decides
// when a request goes out and why one is held; this file only words it.

export const REVIEW_BASE_URL = 'https://jobs.mcloudconstruction.com';

export function reviewUrl(token) {
  return `${REVIEW_BASE_URL}/review/${token}`;
}

export const HOLD_REASONS = {
  not_complete: 'Waiting for the job to be completed',
  suppressed: 'Turned off for this project',
  no_email: 'No customer email on file',
  opted_out: 'Customer opted out of automated email',
  open_punch: 'Waiting on open punch list / warranty items',
  unanswered_message: 'Waiting — the customer has an unanswered message',
  unpaid: 'Waiting until the job is paid',
};

export function holdLabel(code) {
  if (!code) return '';
  if (code.startsWith('held_too_long:')) return `Skipped — held too long (${HOLD_REASONS[code.split(':')[1]] || code.split(':')[1]})`;
  return HOLD_REASONS[code] || code;
}

export const REVIEW_STATUS = {
  scheduled: { label: 'Scheduled', color: '#2f4858', bg: '#e6edf1' },
  sent: { label: 'Sent — awaiting reply', color: '#a17c3f', bg: '#f7efdc' },
  submitted: { label: 'Received', color: '#3a6b45', bg: '#e7f1e9' },
  skipped: { label: 'Not sent', color: '#6b6350', bg: '#efece2' },
};

export function starText(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

export const CATEGORY_LABELS = { communication: 'Communication', quality: 'Quality', schedule: 'Schedule', value: 'Value' };
