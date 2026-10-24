'use client';
import { supabase } from './supabaseClient';

// How recently a person was contacted, shown as a small coloured dot (migration 171 supplies the dates).
//
//   green   contacted within the last 30 days
//   yellow  31 to 60 days ago
//   red     more than 60 days ago, or never contacted
//
// "Contacted" means something reached them or they replied. A missed call or a note does not count.
// The rule lives in the database (crm_people_last_contact) so it matches the property's Last contacted.

const DAY = 24 * 60 * 60 * 1000;

export const GREEN_DAYS = 30;
export const YELLOW_DAYS = 60;

export function daysSince(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!iso || Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY));
}

export function agoText(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// { level: 'green' | 'yellow' | 'red', days, text, title }
export function recencyOf(lastAt, now = Date.now()) {
  const days = daysSince(lastAt, now);
  if (days === null) {
    return { level: 'red', days: null, text: 'Never contacted', title: 'Never contacted' };
  }
  const level = days <= GREEN_DAYS ? 'green' : days <= YELLOW_DAYS ? 'yellow' : 'red';
  const text = `Last contacted ${agoText(days)}`;
  return { level, days, text, title: `${text} (${shortDate(lastAt)})` };
}

// Every person's last contact, as { [contactId]: isoDate }. People never contacted are not in it.
// Before migration 171 is run the function does not exist: the result is { map: null } and no dots show.
export async function loadLastContacts() {
  const { data, error } = await supabase.rpc('crm_people_last_contact');
  if (error) return { map: null, error: error.message };
  const map = {};
  for (const row of data || []) map[row.contact_id] = row.last_at;
  return { map };
}
