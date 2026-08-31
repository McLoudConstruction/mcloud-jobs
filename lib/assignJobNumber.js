import { supabase } from './supabaseClient';
import { nextInSeries } from './constants';

const MAX_ATTEMPTS = 5;

// The one place a real Job Number (or Estimate Number) gets claimed and
// written. Throws on failure rather than silently returning something
// wrong — callers must not advance a job to Approved unless this
// succeeds, or we're right back to a job stuck with no number.
//
// This computes the next number from the true numeric max across every
// existing value in the column (see nextInSeries in constants.js) rather
// than from "whichever row was created most recently" — created_at order
// and number-assignment order are not the same thing here, and trusting
// created_at is what previously handed out numbers that were already
// taken (jobs_job_number_unique_idx / jobs_estimate_number_unique_idx
// violations).
//
// It also writes the number directly to the row and retries on a unique
// violation (Postgres code 23505), which covers the genuine edge case of
// two approvals landing at the same instant — the loser just recomputes
// against the now-updated set of numbers and tries again.
async function claimNextNumber({ jobId, column, fallback }) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: existing, error: fetchErr } = await supabase
      .from('jobs')
      .select(column)
      .not(column, 'is', null);
    if (fetchErr) throw fetchErr;

    const candidate = nextInSeries((existing || []).map(row => row[column]), fallback);

    const { error: writeErr } = await supabase
      .from('jobs')
      .update({ [column]: candidate })
      .eq('id', jobId);

    if (!writeErr) return candidate;

    if (writeErr.code === '23505') {
      // Someone else claimed this exact number between our read and our
      // write — recompute against the fresh set and try again.
      lastError = writeErr;
      continue;
    }
    throw writeErr;
  }

  throw lastError || new Error(`Could not assign a unique ${column} after ${MAX_ATTEMPTS} attempts.`);
}

// jobId is required — the number is written to that row as part of
// claiming it, so it can never be "computed but not actually reserved."
export async function assignNextJobNumber(jobId, fallback) {
  if (!jobId) throw new Error('assignNextJobNumber requires a jobId.');
  return claimNextNumber({
    jobId,
    column: 'job_number',
    fallback: fallback || `${new Date().getFullYear()}-001`,
  });
}

export async function assignNextEstimateNumber(jobId, fallback) {
  if (!jobId) throw new Error('assignNextEstimateNumber requires a jobId.');
  return claimNextNumber({
    jobId,
    column: 'estimate_number',
    fallback: fallback || `EST-${new Date().getFullYear()}-001`,
  });
}
