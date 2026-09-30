'use client';
import { supabase } from './supabaseClient';

// Site requests are opportunities rows with stage = 'site_request' (see
// migration 146). Created from Drive Mode while standing at a stop.

export function projectTypeFromPropertyType(propertyType) {
  return /^residential/i.test(propertyType || '') ? 'residential' : 'commercial';
}

export function formatSiteAddress(p) {
  if (!p) return '';
  const street = [p.property_street, p.property_unit].filter(Boolean).join(' ');
  return [street, p.property_city, [p.property_state, p.property_zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

// Fresh read of the property behind a Drive Mode stop. The stop object is a
// snapshot taken when the route was built, so this picks up edits made
// since (and fields the snapshot never carried, like type and contact).
export async function loadPropertyForSiteRequest(propertyId) {
  if (!propertyId) return { data: null, error: null };
  return supabase
    .from('properties')
    .select('id, property_name, property_type, management_company, property_street, property_unit, property_city, property_state, property_zip, contact_name, contact_phone, contact_email')
    .eq('id', propertyId)
    .maybeSingle();
}

function localDateString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function uploadSiteRequestPhoto(opportunityId, file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${opportunityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('consultation-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (upErr) return { error: upErr };
  const { error: rowErr } = await supabase
    .from('opportunity_photos')
    .insert({ opportunity_id: opportunityId, storage_path: path });
  if (rowErr) {
    // Don't leave an orphaned file behind if its row could not be written.
    await supabase.storage.from('consultation-photos').remove([path]);
    return { error: rowErr };
  }
  return { error: null };
}

// Upload photos one at a time so a single bad file or dropped connection
// only fails that photo. Returns the files that still need to be sent.
export async function uploadSiteRequestPhotos(opportunityId, files) {
  const failed = [];
  for (const file of files) {
    const { error } = await uploadSiteRequestPhoto(opportunityId, file);
    if (error) failed.push(file);
  }
  return failed;
}

// Creates the site request, keeps the contact book in step (same rule the
// Sales "New Lead" form uses), and returns the new opportunity id. Photos
// are uploaded separately by the caller so a photo failure never loses
// the request itself.
export async function createSiteRequest({ property, form }) {
  const projectType = projectTypeFromPropertyType(property?.property_type);
  const contactName = form.contact_name.trim();
  const contactEmail = form.contact_email.trim();
  const contactPhone = form.contact_phone.trim();

  const { data: opp, error } = await supabase
    .from('opportunities')
    .insert({
      stage: 'site_request',
      source: 'drive_mode',
      property_id: property?.id || null,
      site_address: formatSiteAddress(property) || null,
      project_type: projectType,
      company: projectType === 'commercial' ? (property?.management_company || property?.property_name || null) : null,
      project: form.project.trim(),
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      notes: form.notes.trim() || null,
      date_taken: localDateString(),
    })
    .select('id')
    .single();
  if (error) return { id: null, error };

  // Best effort: a contact-book hiccup should not fail the request.
  if (!form.existing_contact_id && (contactEmail || contactName)) {
    try {
      const { data: existing } = contactEmail
        ? await supabase.from('contacts').select('id').eq('contact_email', contactEmail).maybeSingle()
        : { data: null };
      if (!existing) {
        const [first, ...rest] = (contactName || '').split(' ');
        await supabase.from('contacts').insert({
          name: contactName || contactEmail,
          first_name: first || null,
          last_name: rest.join(' ') || null,
          role: 'Property Contact',
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
          property_id: property?.id || null,
          property: property?.property_name || null,
          management_company: property?.management_company || null,
          contact_type: property?.property_type || null,
          address_street: property?.property_street || null,
          address_unit: property?.property_unit || null,
          address_city: property?.property_city || null,
          address_state: property?.property_state || null,
          address_zip: property?.property_zip || null,
        });
      }
    } catch {
      // ignore
    }
  }

  return { id: opp.id, error: null };
}
