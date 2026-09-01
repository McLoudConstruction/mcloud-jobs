'use client';
import { supabase } from './supabaseClient';

function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { first_name: '', last_name: '' };
  const parts = trimmed.split(/\s+/);
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

// Creates a linked Person (a row in contacts) for a company's or
// property's quick-contact fields — but ONLY if no Person already linked
// to this same record has that exact name. This is deliberately
// insert-only: it never edits an existing linked Person's phone/email.
// A name match might be the very same person whose info is being
// corrected here, or it might be someone who replaced them — either way,
// the source of truth for an existing Person's details is People itself,
// not whatever happens to be typed on the Company/Property form. A
// genuinely new name, though, becomes a new Person automatically.
async function syncContactToPeople({ linkColumn, linkId, extraFields, name, phone, email }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName || !linkId) return;

  const { data: existing } = await supabase
    .from('contacts')
    .select('id, name')
    .eq(linkColumn, linkId);

  const alreadyLinked = (existing || []).some(
    c => (c.name || '').trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (alreadyLinked) return;

  const { first_name, last_name } = splitName(trimmedName);
  await supabase.from('contacts').insert({
    name: trimmedName,
    first_name,
    last_name,
    contact_phone: phone || null,
    contact_email: email || null,
    [linkColumn]: linkId,
    ...extraFields,
  });
}

export async function syncCompanyContact({ companyId, companyName, name, phone, email }) {
  await syncContactToPeople({
    linkColumn: 'company_id',
    linkId: companyId,
    extraFields: { management_company: companyName || null },
    name, phone, email,
  });
}

export async function syncPropertyContact({ propertyId, propertyName, managementCompany, name, phone, email }) {
  await syncContactToPeople({
    linkColumn: 'property_id',
    linkId: propertyId,
    extraFields: { property: propertyName || null, management_company: managementCompany || null },
    name, phone, email,
  });
}

// Finds an existing company by name (case-insensitive) or creates a new
// one, returning its id. This is the same "auto-add to Companies if it
// doesn't already exist" behavior the Properties form has always used
// for its management_company field — now shared so People can do the
// same thing instead of leaving management_company as an unlinked string.
export async function linkOrCreateCompanyByName(companyName, { defaultCompanyType = null } = {}) {
  const trimmed = (companyName || '').trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .ilike('company_name', trimmed)
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id;

  const { data: created } = await supabase
    .from('companies')
    .insert({ company_name: trimmed, company_type: defaultCompanyType })
    .select()
    .single();
  return created ? created.id : null;
}

// Finds an existing property by name (case-insensitive). Deliberately
// does NOT create a new property the way linkOrCreateCompanyByName does
// for companies — a property needs a real address to be useful for
// anything, and a contact's free-text "property" field alone isn't
// enough information to create one well.
export async function findPropertyIdByName(propertyName) {
  const trimmed = (propertyName || '').trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from('properties')
    .select('id')
    .ilike('property_name', trimmed)
    .limit(1);
  return data && data.length > 0 ? data[0].id : null;
}
