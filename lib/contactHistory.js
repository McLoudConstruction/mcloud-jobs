'use client';
import { supabase } from './supabaseClient';

// Where a person has worked before (migration 170).
//
// Their CURRENT job lives in the usual fields on the person (company, position, property). Each row
// in contact_history is one PAST job: company, position, the property or portfolio they ran, a start
// and end month, and a note. Property management has high turnover and people move between the same
// few companies, so the notes ("worked with Dana Ruiz") are what start conversations.
//
// If migration 170 has not been run yet, loading returns { missing: true } and the card says so.

export const MIGRATION_HINT = 'Contact history is not set up yet. Run migration 170 in the Supabase SQL Editor.';

function isMissing(error) {
  return Boolean(error) && /contact_history|does not exist|schema cache/i.test(error.message || '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A month input holds "2021-03". The database holds a date, the first of that month.
export function monthToDate(value) {
  return /^\d{4}-\d{2}$/.test(value || '') ? `${value}-01` : null;
}

export function dateToMonth(value) {
  return typeof value === 'string' && value.length >= 7 ? value.slice(0, 7) : '';
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "Mar 2021". Read from the text, not through Date, so a time zone cannot move it to the month before.
export function formatMonth(value) {
  const m = /^(\d{4})-(\d{2})/.exec(value || '');
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim();
}

export function formatRange(started, ended) {
  const a = formatMonth(started);
  const b = formatMonth(ended);
  if (a && b) return a === b ? a : `${a} to ${b}`;
  if (a) return `From ${a}`;
  if (b) return `Until ${b}`;
  return 'Dates not known';
}

// "Property Manager at Maple Group", "Maple Group", or "Property Manager".
export function jobTitle(entry) {
  const company = (entry.company_name || '').trim();
  const position = (entry.position || '').trim();
  if (company && position) return `${position} at ${company}`;
  return company || position || 'Job';
}

// Newest first. An entry with an end month sorts by that, otherwise by its start, and entries with no
// dates at all go last, newest added first.
export function sortHistory(rows) {
  const key = r => (r.ended_on || r.started_on || '');
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && kb && ka !== kb) return kb.localeCompare(ka);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

// Finds a company in Companies by exact name (any case). Never creates one: a past employer is often
// a firm that is not a company we deal with, and the name alone is enough.
async function findCompanyIdByName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[\\%_]/g, c => `\\${c}`);
  const { data } = await supabase.from('companies').select('id').ilike('company_name', escaped).limit(1);
  return data && data.length > 0 ? data[0].id : null;
}

export async function loadContactHistory(contactId) {
  if (!contactId) return { rows: [], missing: false };
  const { data, error } = await supabase.from('contact_history').select('*').eq('contact_id', contactId);
  if (error) {
    if (isMissing(error)) return { rows: [], missing: true };
    return { rows: [], missing: false, error: error.message };
  }
  return { rows: sortHistory(data || []), missing: false };
}

// entry: { company_name, position, property_name, started_month, ended_month, note }
// Pass an id to change an existing entry, leave it out to add one.
export async function saveHistoryEntry(contactId, entry, id = null) {
  const company = (entry.company_name || '').trim();
  const position = (entry.position || '').trim();
  if (!company && !position) return { ok: false, error: 'Add a company or a position.' };
  const started = monthToDate(entry.started_month);
  const ended = monthToDate(entry.ended_month);
  if (started && ended && started > ended) return { ok: false, error: 'The end month is before the start month.' };

  const row = {
    company_name: company || null,
    company_id: await findCompanyIdByName(company),
    position: position || null,
    property_name: (entry.property_name || '').trim() || null,
    started_on: started,
    ended_on: ended,
    note: (entry.note || '').trim() || null,
  };

  const { error } = id
    ? await supabase.from('contact_history').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : await supabase.from('contact_history').insert({ ...row, contact_id: contactId });
  if (error) return { ok: false, error: isMissing(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}

export async function deleteHistoryEntry(id) {
  const { error } = await supabase.from('contact_history').delete().eq('id', id);
  if (error) return { ok: false, error: isMissing(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}

// Logs the job a person just left. The end month is this month unless one is given, the start month
// is not known, and either can be fixed from the card afterwards.
export async function logPreviousJob(contactId, { company, position, property }, endedMonth = currentMonth()) {
  return saveHistoryEntry(contactId, {
    company_name: company,
    position,
    property_name: property,
    started_month: '',
    ended_month: endedMonth,
    note: '',
  });
}

// True when the company or the position was changed on a person who already had one. Case and
// spacing alone do not count, so tidying up a name does not ask to log a job.
export function jobChanged(before, after) {
  const norm = v => (v || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  const hadJob = norm(before.company) || norm(before.position);
  if (!hadJob) return false;
  return norm(before.company) !== norm(after.company) || norm(before.position) !== norm(after.position);
}

// Switches a person on or off. Off hides them from People and stops automated email to them.
export async function setContactActive(contactId, active) {
  const { data, error } = await supabase.from('contacts').update({ is_active: active }).eq('id', contactId)
    .select('is_active, inactive_since').maybeSingle();
  if (!error) return { ok: true, inactive_since: data?.inactive_since || null };
  if (/is_active|schema cache/i.test(error.message || '')) {
    return { ok: false, error: 'Deactivating is not set up yet. Run migration 170 in the Supabase SQL Editor.' };
  }
  return { ok: false, error: error.message };
}
