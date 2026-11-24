import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { canCompleteJob } from '@/lib/waterDayOne';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Complete job: for a restoration job, finishing a visit leaves the job open (drying takes several visits). This is the
// step that completes it, once no visit is still planned or under way. That is also when the invoice draft is made.
// Office and owner can complete any job; a tech only a job they have a visit on.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const admin = getAdmin();
  const { data: job } = await admin.from('jobs').select('id,status').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const { data: visits } = await admin.from('job_visits').select('id,tech_id,status').eq('job_id', job.id);
  if (auth.staff.role === 'tech' && !(visits || []).some((v) => v.tech_id === auth.staff.id)) {
    return NextResponse.json({ error: 'This job is not assigned to you.' }, { status: 403 });
  }
  const active = (visits || []).filter((v) => ['scheduled', 'on_the_way', 'started'].includes(v.status)).length;
  const can = canCompleteJob({ jobStatus: job.status, activeVisits: active });
  if (!can.ok) return NextResponse.json({ error: can.reason }, { status: 409 });
  const ts = new Date().toISOString();
  const { error } = await admin.from('jobs').update({ status: 'completed', completed_at: ts }).eq('id', job.id).eq('status', job.status);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from('job_events').insert({ job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'job_completed', details: { by: 'complete_job' } });
  return NextResponse.json({ ok: true });
}
