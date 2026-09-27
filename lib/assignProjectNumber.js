import { supabase } from './supabaseClient';
import { nextProjectNumber } from './constants';

const MAX_ATTEMPTS = 5;

// The one place a Project Number gets claimed and written — at
// creation, and only at creation. From here on the number lives with
// the project for its whole lifecycle: Approved, Scheduled, Active,
// Completed, Invoiced, Paid never touch it and never hand out a
// different one.
//
// Format: MC{YY}{NNN}{C|R} — see nextProjectNumber in constants.js for
// the full format and why the true numeric max is computed from every
// existing number rather than from "whichever row was created most
// recently."
//
// It writes the number directly to the row and retries on a unique
// violation (Postgres code 23505), which covers the genuine edge case
// of two new-job submissions landing at the same instant — the loser
// just recomputes against the now-updated set of numbers and tries
// again.
export async function assignNextProjectNumber(jobId, projectType) {
  if (!jobId) throw new Error('assignNextProjectNumber requires a jobId.');
  if (projectType !== 'commercial' && projectType !== 'residential') {
    throw new Error('assignNextProjectNumber requires projectType to be "commercial" or "residential".');
  }

  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: existing, error: fetchErr } = await supabase
      .from('jobs')
      .select('project_number')
      .not('project_number', 'is', null);
    if (fetchErr) throw fetchErr;

    const candidate = nextProjectNumber((existing || []).map(row => row.project_number), projectType);

    const { error: writeErr } = await supabase
      .from('jobs')
      .update({ project_number: candidate })
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

  throw lastError || new Error(`Could not assign a unique project number after ${MAX_ATTEMPTS} attempts.`);
}
