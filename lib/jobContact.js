'use client';
import { supabase } from './supabaseClient';

// A job can be linked to a person in People (migration 173). The classic case: a commercial contact,
// such as a property manager, hires us for their own house. The job is residential and the person
// stays a commercial contact. The typed in customer fields on the job are not touched by the link.
//
// Before migration 173 is run the column does not exist: reads return { missing: true } and the
// screens say so.

export const MIGRATION_HINT = 'Linking a job to a person is not set up yet. Run migration 173 in the Supabase SQL Editor.';

const JOB_COLUMNS = 'id, project_number, project_type, customer_name, project_address, stage, created_at';

function isMissing(error) {
  return Boolean(error) && /contact_id|schema cache|does not exist/i.test(error.message || '');
}

// The person a job is linked to, or null. { person, missing }
export async function personOfJob(jobId) {
  const { data: job, error } = await supabase.from('jobs').select('contact_id').eq('id', jobId).maybeSingle();
  if (error) return { person: null, missing: isMissing(error), error: isMissing(error) ? '' : error.message };
  if (!job?.contact_id) return { person: null, missing: false };
  const { data: person } = await supabase
    .from('contacts')
    .select('id, name, contact_type, management_company, position, contact_email, contact_phone, is_active')
    .eq('id', job.contact_id)
    .maybeSingle();
  return { person: person || null, missing: false };
}

// Jobs linked to a person, newest first. { rows, missing }
export async function jobsOfContact(contactId) {
  if (!contactId) return { rows: [], missing: false };
  const { data, error } = await supabase.from('jobs').select(JOB_COLUMNS).eq('contact_id', contactId).order('created_at', { ascending: false });
  if (error) return { rows: [], missing: isMissing(error), error: isMissing(error) ? '' : error.message };
  return { rows: data || [], missing: false };
}

// Jobs to pick from, by customer name, project number or address. Skips the ones already chosen.
export async function searchJobs(term, excludeIds = []) {
  const t = (term || '').replace(/[,()%*]/g, ' ').trim();
  if (t.length < 2) return [];
  const { data } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .or(`customer_name.ilike.%${t}%,project_number.ilike.%${t}%,project_address.ilike.%${t}%,customer_contact.ilike.%${t}%`)
    .order('created_at', { ascending: false })
    .limit(12);
  const skip = new Set(excludeIds);
  return (data || []).filter(j => !skip.has(j.id)).slice(0, 8);
}

// Links a job to a person, or clears the link with null.
export async function setJobContact(jobId, contactId) {
  const { error } = await supabase.from('jobs').update({ contact_id: contactId || null }).eq('id', jobId);
  if (error) return { ok: false, error: isMissing(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}

// "Residential" or "Commercial", for labels.
export function jobKindLabel(job) {
  return job?.project_type === 'commercial' ? 'Commercial' : 'Residential';
}
