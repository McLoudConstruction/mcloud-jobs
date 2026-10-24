'use client';
import { supabase } from './supabaseClient';

// A person can be linked to several properties (migration 169).
//
//   contacts.property_id   the person's MAIN property. The Property field on the Person form
//                          edits this one, and the bot API reads it.
//   contact_properties     every property the person is linked to, the main one included.
//
// Every screen that lists "the people at a property" goes through here, so a person who looks
// after three buildings shows up at all three. If migration 169 has not been run yet, each
// function falls back to the old single link, so the app keeps working until it is.

const MIGRATION_HINT = 'Linking several properties is not set up yet. Run migration 169 in the Supabase SQL Editor.';

function missingTable(error) {
  return Boolean(error) && /contact_properties|does not exist|schema cache/i.test(error.message || '');
}

function explain(error) {
  if (!error) return '';
  if (/crm_(un)?link_contact_property/.test(error.message || '') && /not.*find|does not exist|schema cache/i.test(error.message || '')) return MIGRATION_HINT;
  return error.message || 'Something went wrong.';
}

// People at a property, whether it is their main property or one of several.
// columns: the contacts columns to return. sortBy: 'name' (default) or 'newest'.
// activeOnly (default true): leave out people switched to inactive (migration 170). The Property
// popup passes false so it can show them dimmed.
export async function contactsAtProperty(propertyId, { columns = '*', sortBy = 'name', activeOnly = true } = {}) {
  if (!propertyId) return [];
  const base = columns === '*'
    ? ['*']
    : Array.from(new Set(['id', 'name', 'created_at', ...columns.split(',').map(c => c.trim()).filter(Boolean)]));

  async function fetchRows(colList) {
    const cols = colList.join(', ');
    const { data, error } = await supabase
      .from('contact_properties')
      .select(`contacts(${cols})`)
      .eq('property_id', propertyId);
    if (!error) return (data || []).map(r => r.contacts).filter(Boolean);
    if (!missingTable(error)) console.error('contactsAtProperty failed:', error.message);
    // Migration 169 not run yet: the old single link.
    const fallback = await supabase.from('contacts').select(cols).eq('property_id', propertyId);
    return fallback.error ? null : (fallback.data || []);
  }

  // is_active only exists after migration 170, so ask for it, and ask again without it if that fails.
  let rows = await fetchRows(columns === '*' ? base : [...base, 'is_active']);
  if (rows === null && columns !== '*') rows = await fetchRows(base);
  rows = rows || [];

  if (activeOnly) rows = rows.filter(r => r.is_active !== false);
  rows.sort(sortBy === 'newest'
    ? (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
    : (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  return rows;
}

function addressLine(p) {
  const street = [p.property_street, p.property_unit].filter(Boolean).join(' ');
  return [street, p.property_city].filter(Boolean).join(', ');
}

// Every property a person is linked to, main first. Each: { id, name, address, isMain }.
export async function propertiesOfContact(contactId) {
  if (!contactId) return [];
  const cols = 'id, property_name, property_street, property_unit, property_city';
  const [links, contact] = await Promise.all([
    supabase.from('contact_properties').select(`created_at, properties(${cols})`).eq('contact_id', contactId),
    supabase.from('contacts').select('property_id').eq('id', contactId).maybeSingle(),
  ]);
  const mainId = contact.data?.property_id || null;

  let props;
  if (links.error) {
    if (!missingTable(links.error)) console.error('propertiesOfContact failed:', links.error.message);
    if (!mainId) return [];
    const { data } = await supabase.from('properties').select(cols).eq('id', mainId).maybeSingle();
    props = data ? [{ at: '', p: data }] : [];
  } else {
    props = (links.data || []).filter(r => r.properties).map(r => ({ at: r.created_at || '', p: r.properties }));
  }

  return props
    .map(({ at, p }) => ({ id: p.id, name: p.property_name || 'Unnamed property', address: addressLine(p), isMain: p.id === mainId, at }))
    .sort((a, b) => (a.isMain === b.isMain ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.isMain ? -1 : 1));
}

// Properties to pick from, by name or street. Skips the ones already chosen.
export async function searchProperties(term, excludeIds = []) {
  const t = (term || '').replace(/[,()%*]/g, ' ').trim();
  if (t.length < 2) return [];
  const { data } = await supabase
    .from('properties')
    .select('id, property_name, property_street, property_unit, property_city')
    .or(`property_name.ilike.%${t}%,property_street.ilike.%${t}%`)
    .order('property_name', { ascending: true })
    .limit(12);
  const skip = new Set(excludeIds);
  return (data || []).filter(p => !skip.has(p.id)).slice(0, 8)
    .map(p => ({ id: p.id, name: p.property_name || 'Unnamed property', address: addressLine(p) }));
}

// People to pick from, by name or email. Skips the ones already chosen.
export async function searchPeople(term, excludeIds = []) {
  const t = (term || '').replace(/[,()%*]/g, ' ').trim();
  if (t.length < 2) return [];
  const { data } = await supabase
    .from('contacts')
    .select('id, name, position, management_company, contact_email, contact_type')
    .or(`name.ilike.%${t}%,contact_email.ilike.%${t}%`)
    .not('is_test', 'is', true)
    .order('name', { ascending: true })
    .limit(12);
  const skip = new Set(excludeIds);
  return (data || []).filter(c => !skip.has(c.id)).slice(0, 8);
}

// Links a person to one more property. A person with no property yet gets this one as their main.
export async function linkContactToProperty(contactId, propertyId) {
  const { data, error } = await supabase.rpc('crm_link_contact_property', { p_contact_id: contactId, p_property_id: propertyId });
  if (error) return { ok: false, error: explain(error) };
  return { ok: true, ...(data || {}) };
}

// Removes one link. The person and the property both stay. If it was the main property and
// others remain, the oldest of the others becomes the main one.
export async function unlinkContactFromProperty(contactId, propertyId) {
  const { data, error } = await supabase.rpc('crm_unlink_contact_property', { p_contact_id: contactId, p_property_id: propertyId });
  if (error) return { ok: false, error: explain(error) };
  return { ok: true, ...(data || {}) };
}

// The Property field on the Person form holds a name. Turns it into the id to save as the main
// property. If the name still matches the person's current main property, that one is kept, so
// two properties sharing a name cannot swap the link by accident.
export async function resolveMainPropertyId(propertyName, contactId) {
  const name = (propertyName || '').trim();
  if (!name) return null;
  if (contactId) {
    const { data: current } = await supabase.from('contacts').select('property_id').eq('id', contactId).maybeSingle();
    if (current?.property_id) {
      const { data: prop } = await supabase.from('properties').select('property_name').eq('id', current.property_id).maybeSingle();
      if (prop && (prop.property_name || '').trim().toLowerCase() === name.toLowerCase()) return current.property_id;
    }
  }
  const { data } = await supabase.from('properties').select('id').ilike('property_name', name).limit(1);
  return data && data.length > 0 ? data[0].id : null;
}
