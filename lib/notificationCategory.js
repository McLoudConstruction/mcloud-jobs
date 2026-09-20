// Every notification is still just a freeform `message` sentence built at
// insert time (see the various `.from('notifications').insert(...)` call
// sites) — there's no dedicated `category` column on the table yet. Rather
// than block the compact-row redesign on a schema migration, this derives a
// short, scannable type label by pattern-matching the handful of message
// shapes those call sites actually produce. If a new call site is added with
// wording that doesn't match anything below, it just falls back to "Update"
// — never breaks, just less specific. A real `category` column (set at
// insert time instead of guessed at read time) would be the cleaner
// long-term fix if more notification types get added.
const PATTERNS = [
  { label: 'New Consultation Request', test: /consultation request/i },
  { label: 'Contract Submitted', test: /contract was submitted/i },
  { label: 'Payment Received', test: /^payment received/i },
  { label: 'Payment Failed', test: /^payment failed/i },
  { label: 'Subcontractor Application', test: /subcontractor application/i },
  { label: 'Ready to Invoice', test: /flagged ready to invoice/i },
  { label: 'Schedule Alert', test: /schedule may be out of date/i },
  { label: 'Work Order Accepted', test: /accepted the work order/i },
  { label: 'Work Order Declined', test: /declined the work order/i },
  { label: 'Field Progress', test: /marked field progress/i },
  { label: 'Sub Invoice', test: /uploaded their invoice/i },
  { label: 'RFP Proposal', test: /submitted a proposal for/i },
  { label: 'Change Order Approved', test: /approved .* on job/i },
  { label: 'Change Order Declined', test: /declined .* on job/i },
  { label: 'New Message', test: /sent a message on job/i },
];

export function categorizeNotification(message) {
  if (!message) return 'Update';
  const hit = PATTERNS.find(p => p.test.test(message));
  return hit ? hit.label : 'Update';
}
