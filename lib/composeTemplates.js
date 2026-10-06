import { supabase } from './supabaseClient';

// One click email composing. A saved template (email_compose_templates) is
// filled with details about the contact and opened as a new message in the
// person's own email provider. The app never sends anything itself.

export const MERGE_FIELDS = [
  { key: 'first_name', label: 'First name', hint: 'Contact first name' },
  { key: 'full_name', label: 'Full name', hint: 'Contact full name' },
  { key: 'company', label: 'Company', hint: 'Management company or company name' },
  { key: 'property', label: 'Property', hint: 'Property name' },
  { key: 'sender_name', label: 'My name', hint: 'Your name from your staff profile' },
];

export const PROVIDERS = [
  { value: 'default', label: 'Default mail app' },
  { value: 'gmail', label: 'Gmail (web)' },
  { value: 'outlook', label: 'Outlook (web)' },
];

const PROVIDER_STORAGE_KEY = 'mcloud_compose_provider';

export function getSavedProvider() {
  try {
    const v = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    return PROVIDERS.some(p => p.value === v) ? v : 'default';
  } catch {
    return 'default';
  }
}

export function saveProvider(value) {
  try { window.localStorage.setItem(PROVIDER_STORAGE_KEY, value); } catch { /* storage unavailable */ }
}

export async function listComposeTemplates() {
  const { data, error } = await supabase
    .from('email_compose_templates')
    .select('id, name, subject, body, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Replaces {{field}} tokens. Unknown tokens are left alone so a typo is
// visible in the draft instead of silently vanishing. A known field with no
// value becomes an empty string, and the leftover spacing is tidied.
export function fillTemplate(text, vars) {
  const filled = String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const k = key.toLowerCase();
    if (!MERGE_FIELDS.some(f => f.key === k)) return match;
    return (vars && vars[k]) ? String(vars[k]) : '';
  });
  return filled
    .replace(/\b(Hi|Hello|Hey|Dear) ?,/g, '$1 there,')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

export function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function encode(value) {
  return encodeURIComponent(value || '');
}

// Real mail clients want CRLF line breaks inside a mailto body.
function crlf(text) {
  return String(text || '').replace(/\r?\n/g, '\r\n');
}

export function buildComposeUrl({ provider = 'default', to = '', subject = '', body = '' }) {
  if (provider === 'gmail') {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encode(to)}&su=${encode(subject)}&body=${encode(body)}`;
  }
  if (provider === 'outlook') {
    return `https://outlook.office.com/mail/deeplink/compose?to=${encode(to)}&subject=${encode(subject)}&body=${encode(body)}`;
  }
  return `mailto:${to}?subject=${encode(subject)}&body=${encode(crlf(body))}`;
}

// Opens the draft. Web providers open in a new tab. The default mail app
// uses a mailto link, which hands off to whatever the device has set up.
export function openCompose({ provider, to, subject, body }) {
  const url = buildComposeUrl({ provider, to, subject, body });
  if (provider === 'gmail' || provider === 'outlook') {
    window.open(url, '_blank', 'noopener');
  } else {
    window.location.href = url;
  }
  return url.length;
}

// Very long drafts can be cut off by mail clients that cap link length.
export const LONG_DRAFT_WARNING_LENGTH = 1800;
