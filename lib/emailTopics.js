// The short label an Inbox conversation carries ("Estimate Sent", "RFP Sent")
// so staff can tell what a conversation is about without opening it. Sends
// pass their `category` (already threaded through every call site for the
// Communications Log); free-typed emails have no category and fall back to
// their own subject line, which is what the person typed as the topic.
const TOPICS = {
  proposal: 'Estimate Sent',
  estimate: 'Estimate Sent',
  contract: 'Contract Sent',
  invoice: 'Invoice Sent',
  'project update': 'Project Update Sent',
  'change order': 'Change Order Sent',
  'material selection': 'Material Selection Sent',
  material_selection: 'Material Selection Sent',
  work_order: 'Work Order Sent',
  subcontractor_work_order: 'Work Order Sent',
  rfp_sent: 'RFP Sent',
  rfp_reminder: 'RFP Reminder',
  rfp_awarded: 'RFP Awarded',
  portal_invite: 'Portal Invite Sent',
  review_request: 'Review Request',
  schedule_reminder: 'Schedule Reminder',
  schedule_change: 'Schedule Update',
  proposal_followup: 'Estimate Follow-up',
  payment_failed: 'Payment Failed',
  punch_review: 'Punch List Review',
  punch_final: 'Final Punch List',
  punch_assigned: 'Punch Item Assigned',
  punch_update: 'Punch List Update',
  punch_schedule_request: 'Punch Items to Schedule',
  warranty_update: 'Warranty Update',
  lien_waiver_requested: 'Lien Waiver Requested',
  compliance_expiring: 'Document Expiring',
  compliance_expired: 'Document Expired',
  compliance_reviewed: 'Compliance Document Reviewed',
  customer_change: 'Customer Change',
  weather: 'Weather Notice',
};

export function stripSubjectNoise(subject) {
  return (subject || '')
    .replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '')
    .replace(/\[(?:Project|Job) #[A-Za-z0-9-]+\]\s*/i, '')
    .trim();
}

// Returns the label for a send, or null when the subject itself should be
// the topic (the Inbox does that fallback so old rows work too).
export function topicFor(category) {
  return TOPICS[(category || '').toLowerCase()] || null;
}
