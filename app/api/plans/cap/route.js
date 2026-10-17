import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getJobBudget } from '../../../../lib/planTakeoff';

// Raises (or lowers) the plan analysis token cap for one job. Owners only,
// because this is what controls AI spend.
export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return Response.json({ error: auth.status === 403 ? 'Only an owner can change the plan analysis cap.' : auth.error }, { status: auth.status });
  let jobId; let tokenCap;
  try { ({ jobId, tokenCap } = await request.json()); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }
  const cap = Math.round(Number(tokenCap));
  if (!jobId || !Number.isFinite(cap) || cap < 100000 || cap > 20000000) {
    return Response.json({ error: 'Choose a cap between 100,000 and 20,000,000 tokens.' }, { status: 400 });
  }
  const admin = getAdminClient();
  const { error } = await admin.from('job_plan_budget').upsert({ job_id: jobId, token_cap: cap, updated_by: auth.staffId, updated_at: new Date().toISOString() });
  if (error) return Response.json({ error: 'Could not save the cap: ' + error.message }, { status: 500 });
  const budget = await getJobBudget(admin, jobId);
  return Response.json({ ok: true, cap: budget.cap, used: budget.used });
}
