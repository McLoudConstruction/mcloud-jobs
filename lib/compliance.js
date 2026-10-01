// Shared definitions for the Sub Compliance Vault (migration 133). The
// database decides what a sub's status IS (sub_compliance_summary); this file
// only says how to label and colour it, so the staff screens, the Sub Portal,
// and the work-order gate all speak the same language.

export const COMPLIANCE_DOC_TYPES = [
  { key: 'w9', label: 'W-9', short: 'W-9', needsExpiry: false, insurance: false },
  { key: 'coi_gl', label: 'General Liability certificate', short: 'GL', needsExpiry: true, insurance: true },
  { key: 'coi_wc', label: "Workers' Comp certificate", short: 'WC', needsExpiry: true, insurance: true },
  { key: 'coi_auto', label: 'Auto certificate', short: 'Auto', needsExpiry: true, insurance: true },
  { key: 'license', label: 'Trade / business license', short: 'License', needsExpiry: true, insurance: false },
  { key: 'other', label: 'Other document', short: 'Other', needsExpiry: false, insurance: false },
];

export const DOC_TYPE_BY_KEY = Object.fromEntries(COMPLIANCE_DOC_TYPES.map(t => [t.key, t]));

export function docTypeLabel(key) {
  return DOC_TYPE_BY_KEY[key]?.label || 'Document';
}

// Colours match the app's existing green / amber / red used for COI dots.
export const COMPLIANCE_STATUS = {
  ok: { label: 'Current', color: '#3a6b45', bg: '#e7f1e9' },
  expiring: { label: 'Expiring soon', color: '#a17c3f', bg: '#f7efdc' },
  expired: { label: 'Expired', color: '#a13f3f', bg: '#fbeae7' },
  missing: { label: 'Missing', color: '#a13f3f', bg: '#fbeae7' },
  pending: { label: 'Awaiting review', color: '#2f4858', bg: '#e6edf1' },
  rejected: { label: 'Rejected', color: '#a13f3f', bg: '#fbeae7' },
  insufficient: { label: 'Coverage too low', color: '#a13f3f', bg: '#fbeae7' },
};

export const COMPLIANCE_OVERALL = {
  compliant: { label: 'Compliant', color: '#3a6b45', bg: '#e7f1e9' },
  expiring: { label: 'Expiring soon', color: '#a17c3f', bg: '#f7efdc' },
  noncompliant: { label: 'Non-compliant', color: '#a13f3f', bg: '#fbeae7' },
  exempt: { label: 'Exempt', color: '#6b6350', bg: '#efece2' },
};

export const ENFORCEMENT_MODES = [
  { key: 'off', label: 'Off — the vault is informational only' },
  { key: 'warn', label: 'Warn — show warnings, never block' },
  { key: 'block', label: 'Block — no work orders issued or paid to a non-compliant sub (staff can override with a reason)' },
];

export function fmtComplianceDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDaysLeft(days) {
  if (days === null || days === undefined) return '';
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

// Short human sentence listing what's outstanding, e.g.
// "General Liability certificate (expired), W-9 (missing)".
export function complianceGapText(summary) {
  const gaps = (summary?.required || []).filter(r => ['missing', 'expired', 'rejected', 'insufficient', 'pending'].includes(r.status));
  return gaps.map(r => `${docTypeLabel(r.doc_type)} (${(COMPLIANCE_STATUS[r.status]?.label || r.status).toLowerCase()})`).join(', ');
}

export function safeFileName(name) {
  return String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
}

// What the compliance upload forms accept: PDFs and images. Extensions are
// listed alongside the MIME patterns because some phones and file managers
// report an empty or unusual MIME type (HEIC photos, PDFs from cloud apps),
// and a bare MIME accept list then greys those files out in the picker.
export const COMPLIANCE_FILE_ACCEPT =
  'application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif';

export const COMPLIANCE_MAX_FILE_BYTES = 25 * 1024 * 1024;

const EXT_TO_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

// Checks the chosen file is a PDF or image and works out the content type to
// store it with. Relying on file.type alone fails for files the browser can't
// classify (it comes back as ''), which then get stored as a generic blob and
// open as text or download instead of previewing.
export function checkComplianceFile(file) {
  if (!file) return { ok: false, error: 'Choose a file first.' };
  const ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  let contentType = null;
  if (type === 'application/pdf' || type.startsWith('image/')) contentType = type;
  else if (EXT_TO_MIME[ext]) contentType = EXT_TO_MIME[ext];
  if (!contentType) {
    return { ok: false, error: 'That file type isn’t supported. Upload a PDF or an image (JPG, PNG, HEIC, WebP).' };
  }
  if (file.size > COMPLIANCE_MAX_FILE_BYTES) {
    return { ok: false, error: 'That file is larger than 25 MB. Upload a smaller PDF or photo.' };
  }
  if (file.size === 0) return { ok: false, error: 'That file is empty. Choose a different file.' };
  return { ok: true, contentType };
}

// Opens a private storage file in a new tab. The tab is opened synchronously
// (inside the click) and pointed at the signed URL afterwards — calling
// window.open() after an await gets killed by popup blockers (see
// technical-learnings), but navigating an already-open tab does not.
export async function openStorageDoc(supabase, bucket, path, expiresIn = 300) {
  if (!path) return;
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    if (tab) tab.close();
    throw new Error(error?.message || 'Could not open that file.');
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
