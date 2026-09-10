'use client';
import { supabase } from './supabaseClient';

// Call after any job_scope_actions insert/update/delete succeeds. Only
// does anything if the job actually has a confirmed schedule (job_phases
// rows) — a trade breakdown edit on a job with no schedule yet is just
// normal scoping work, nothing to flag.
//
// Deliberately a no-op if the job is already flagged stale, rather than
// re-touching schedule_stale_at or inserting another notification — this
// keeps editing several actions in a row from spamming the notification
// list with one entry per save.
export async function flagScheduleStale(jobId) {
  const { count } = await supabase
    .from('job_phases')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId);
  if (!count) return;

  const { data: jobRow } = await supabase
    .from('jobs')
    .select('schedule_stale_at, job_number, estimate_number')
    .eq('id', jobId)
    .single();
  if (jobRow?.schedule_stale_at) return;

  await supabase.from('jobs').update({ schedule_stale_at: new Date().toISOString() }).eq('id', jobId);
  await supabase.from('notifications').insert({
    message: `Trade breakdown changed on Job #${jobRow?.job_number || jobRow?.estimate_number || ''} — the schedule may be out of date.`,
    job_id: jobId,
  });
}
