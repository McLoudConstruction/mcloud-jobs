// Labels/colours for lien waivers (migration 134). The database owns the
// waiver wording (render_lien_waiver_text) — this file only names things.

export const WAIVER_TYPES = ['conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final'];

export const WAIVER_TYPE_LABELS = {
  conditional_progress: 'Conditional waiver — progress payment',
  unconditional_progress: 'Unconditional waiver — progress payment',
  conditional_final: 'Conditional waiver — final payment',
  unconditional_final: 'Unconditional waiver — final payment',
};

export const WAIVER_STATUS = {
  requested: { label: 'Awaiting signature', color: '#a17c3f', bg: '#f7efdc' },
  signed: { label: 'Signed', color: '#3a6b45', bg: '#e7f1e9' },
  rejected: { label: 'Sub questioned it', color: '#a13f3f', bg: '#fbeae7' },
  waived: { label: 'Received on paper', color: '#2f4858', bg: '#e6edf1' },
  void: { label: 'Void', color: '#6b6350', bg: '#efece2' },
};

export const WAIVER_ENFORCEMENT_MODES = [
  { key: 'off', label: 'Off — waivers are tracked but never checked' },
  { key: 'warn', label: 'Warn — warn before paying a sub with no signed waiver' },
  { key: 'block', label: 'Block — a sub cannot be marked paid without a signed waiver and none outstanding (staff can override with a reason)' },
];
