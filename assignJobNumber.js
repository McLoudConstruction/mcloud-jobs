import { supabase } from './supabaseClient';
import { nextSequentialNumber } from './constants';

// The one place a real Job Number gets created. Throws on failure rather
// than silently returning something wrong — callers must not advance a
// job to Approved unless this succeeds, or we're right back to a job
// stuck with no number.
export async function assignNextJobNumber(fallback) {
  const { data: last, error: fetchErr } = await supabase
    .from('jobs')
    .select('job_number')
    .not('job_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (fetchErr) throw fetchErr;
  const lastNumber = last && last[0] && last[0].job_number;
  return nextSequentialNumber(lastNumber, fallback);
}
