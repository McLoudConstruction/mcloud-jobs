import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from '../../../../lib/supabaseAdmin';

// Read-only: finds every distinct customer email across all non-lost jobs
// (jobs.customer_email / billing_email, plus job_portal_access rows with
// portal_access = true) that doesn't already have an activated portal
// account. Used to preview and drive the one-time (or occasional) bulk
// backfill from Settings → Communications Log — actually sending is a
// separate call per email to /api/portal/create-invite, made from the
// client in a loop, so this endpoint never has to run long enough to risk
// a serverless timeout on its own.
//
// Lost-stage jobs are excluded on purpose: has_job_portal_access() denies
// access to a lost job regardless of any invite, so activating an account
// for one would just land that customer on "No active project."

function callerClient(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }
    const { accessToken } = await request.json();
    if (!accessToken) {
      return Response.json({ error: 'Missing access token.' }, { status: 400 });
    }

    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }
    if (caller.app_metadata?.role !== 'admin') {
      return Response.json({ error: 'Only staff can do this.' }, { status: 403 });
    }

    const service = getAdminClient();

    const { data: jobs, error: jobsError } = await service
      .from('jobs')
      .select('id, job_number, customer_name, customer_email, billing_email')
      .neq('stage', 'lost');
    if (jobsError) return Response.json({ error: jobsError.message }, { status: 500 });

    const jobIds = (jobs || []).map(j => j.id);
    const { data: accessRows, error: accessError } = jobIds.length
      ? await service.from('job_portal_access').select('job_id, email, name').eq('portal_access', true).in('job_id', jobIds)
      : { data: [], error: null };
    if (accessError) return Response.json({ error: accessError.message }, { status: 500 });

    const jobById = Object.fromEntries((jobs || []).map(j => [j.id, j]));
    const byEmail = new Map(); // normalizedEmail -> { email, customerName, jobId, jobNumber }

    for (const j of jobs || []) {
      for (const raw of [j.customer_email, j.billing_email]) {
        const norm = normalizeEmail(raw);
        if (norm && !byEmail.has(norm)) {
          byEmail.set(norm, { email: raw.trim(), customerName: j.customer_name || null, jobId: j.id, jobNumber: j.job_number });
        }
      }
    }
    for (const row of accessRows || []) {
      const norm = normalizeEmail(row.email);
      if (norm && !byEmail.has(norm)) {
        const j = jobById[row.job_id];
        byEmail.set(norm, { email: row.email.trim(), customerName: row.name || j?.customer_name || null, jobId: row.job_id, jobNumber: j?.job_number });
      }
    }

    const allEmails = Array.from(byEmail.keys());
    const { data: accounts, error: accountsError } = allEmails.length
      ? await service.from('portal_accounts').select('email, activated_at').in('email', allEmails)
      : { data: [], error: null };
    if (accountsError) return Response.json({ error: accountsError.message }, { status: 500 });

    const activatedSet = new Set((accounts || []).filter(a => a.activated_at).map(a => a.email));
    const candidates = allEmails.filter(e => !activatedSet.has(e)).map(e => byEmail.get(e));

    return Response.json({
      candidates,
      totalCustomers: allEmails.length,
      alreadyActivated: activatedSet.size,
      totalJobsScanned: (jobs || []).length,
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to compute backfill candidates.' }, { status: 500 });
  }
}
