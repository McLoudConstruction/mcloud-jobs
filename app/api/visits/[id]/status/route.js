import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/apiAuth';
import { getAdmin } from '@/lib/supabaseAdmin';
import { planTransition } from '@/lib/visitFlow';
import { siteUrl } from '@/lib/integrations';
import { sendAftercare } from '@/lib/aftercareServer';
import { advancePlan } from '@/lib/outreach';
import { applyClockForVisit } from '@/lib/clockServer';
import { isReturnVisit } from '@/lib/visitCrew';
import { sendSms, sendEmail } from '@/lib/notify';
import { shouldNotify, buildOnTheWayMessages, arrivalAt, timeText } from '@/lib/onTheWay';
import { usesDayOneSteps } from '@/lib/waterDayOne';

export const dynamic = 'force-dynamic';

// For a replayed tap: the visit states that mean the step (or a later one) has already happened.
const ALREADY_PAST = { on_the_way: ['started', 'finished'], started: ['started', 'finished'], finished: ['finished'] };

// Body: { action: 'on_the_way' | 'started' | 'finished', minutes?: 5..120 in steps of 5, live?: true when the minutes came from the live drive time, at?: ISO time, op_id?: uuid, replay?: true }
// A tap made with no signal is sent later with `at` (when it really happened) and `op_id`, so a retry is applied once.
// With `replay`, a step the visit has already moved past answers 409 { code: 'STALE' } instead of an error.
// Techs may only act on their own visits. Office and owner may send On the way or Finish on any visit, but only the assigned team member can start it.
// Uses the service role so a tech never needs write access to visits or jobs.
export async function POST(request, { params }) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const admin = getAdmin();
  const opId = typeof body.op_id === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.op_id) ? body.op_id : null;
  // the time the tap really happened: accepted if it is not in the future and not older than 3 days
  const at = new Date(body.at);
  const now = new Date();
  const when = Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() + 5 * 60 * 1000 && at.getTime() >= now.getTime() - 3 * 24 * 3600 * 1000 ? (at > now ? now : at) : now;

  const { data: visit } = await admin.from('job_visits').select('*').eq('id', params.id).maybeSingle();
  if (!visit) return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  if (auth.staff.role === 'tech' && visit.tech_id !== auth.staff.id) {
    return NextResponse.json({ error: 'This visit is not assigned to you.' }, { status: 403 });
  }
  // Start job is for the team member the visit is assigned to; office and owner can still send On the way and Finish
  if (body.action === 'started' && visit.tech_id !== auth.staff.id) {
    return NextResponse.json({ error: 'Only the team member assigned to this visit can start the job.' }, { status: 403 });
  }

  if (opId) {
    // already applied (the phone did not hear back the first time)
    const { count: seen } = await admin.from('job_events').select('id', { count: 'exact', head: true }).eq('job_id', visit.job_id).contains('details', { op_id: opId });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const { data: job } = await admin.from('jobs').select('id,status,customer_id,service,job_type').eq('id', visit.job_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (['closed', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ error: `This job is ${job.status}.`, code: 'JOB_CLOSED' }, { status: 409 });
  }

  // other visits still planned or under way. A crew mate who has not started is part of this same visit, not a return trip.
  const { data: otherRows } = await admin
    .from('job_visits')
    .select('id,crew_id,status')
    .eq('job_id', visit.job_id)
    .neq('id', visit.id)
    .in('status', ['scheduled', 'on_the_way', 'started']);
  const othersActive = (otherRows || []).filter((r) => isReturnVisit(r, visit)).length;

  const plan = planTransition({ visit, action: body.action, minutes: body.minutes, live: body.live === true, othersActive: othersActive || 0, restoration: usesDayOneSteps(job.service, job.job_type), now: when });
  if (plan.error) {
    if (body.replay && ALREADY_PAST[body.action]?.includes(visit.status)) return NextResponse.json({ error: plan.error, code: 'STALE' }, { status: 409 });
    return NextResponse.json({ error: plan.error }, { status: 400 });
  }

  // Only apply if the visit is still in the status we planned from (guards double taps).
  const { data: updated, error } = await admin
    .from('job_visits')
    .update(plan.visitPatch)
    .eq('id', visit.id)
    .eq('status', visit.status)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'This visit just changed. Refresh and try again.', code: 'CHANGED' }, { status: 409 });

  await admin.from('jobs').update(plan.jobPatch).eq('id', job.id);
  if (plan.touchCustomerLastVisit) {
    await admin.from('customers').update({ last_visit_at: plan.touchCustomerLastVisit }).eq('id', job.customer_id);
  }
  await admin.from('job_events').insert({
    job_id: job.id,
    actor_id: auth.staff.id,
    actor_email: auth.staff.email,
    kind: plan.eventKind,
    details: opId ? { ...plan.eventDetails, op_id: opId, at: when.toISOString() } : plan.eventDetails,
  });

  // On the way: text and email the customer the time and a link to their visit page. A problem here never fails the tap.
  try {
    const { data: st } = await admin.from('settings').select('business_name,timezone,ontheway_auto').eq('id', 1).maybeSingle();
    if (shouldNotify({ action: body.action, enabled: st?.ontheway_auto, when })) {
      const { data: cj } = await admin.from('jobs').select('customer:customers(display_name,phone,email)').eq('id', job.id).maybeSingle();
      const who = cj?.customer || {};
      const link = `${siteUrl(request)}/v/${updated.share_token}`;
      const arrive = timeText(arrivalAt(updated.on_the_way_at, updated.minutes_out), st?.timezone || undefined);
      const msgs = buildOnTheWayMessages({ business: st?.business_name, customerName: who.display_name, minutes: updated.minutes_out, arrive, link, late: visit.status === 'on_the_way' });
      const [sms, email] = await Promise.all([
        who.phone ? sendSms({ to: who.phone, body: msgs.sms }) : { status: 'skipped', detail: 'No phone number on file.' },
        who.email ? sendEmail({ to: who.email, subject: msgs.subject, html: msgs.html, text: msgs.text }) : { status: 'skipped', detail: 'No email on file.' },
      ]);
      await admin.from('job_events').insert({ job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'on_the_way_sent', details: { visit_id: visit.id, sms: { status: sms.status, detail: sms.detail }, email: { status: email.status, detail: email.detail } } });
    }
  } catch (e) { console.error('on the way message:', e.message); }

  // The job is complete: crew mates who never started are not coming, so their waiting visit is cancelled rather than left on their schedule.
  if ((plan.jobPatch.status === 'completed' || plan.keepOpen) && visit.crew_id) {
    try {
      const { data: gone } = await admin.from('job_visits').update({ status: 'cancelled' }).eq('crew_id', visit.crew_id).eq('status', 'scheduled').neq('id', visit.id).select('id,tech_id');
      if (gone?.length) await admin.from('job_events').insert({ job_id: job.id, actor_id: auth.staff.id, actor_email: auth.staff.email, kind: 'visit_cancelled', details: { crew: gone.map((g) => g.tech_id), note: 'Team member never started; the visit finished without them.' } });
    } catch { /* the visit is already saved */ }
  }

  // The job clock follows the buttons: restoration starts at On the way, carpet at Start job, Finish job stops it.
  // The tap is already saved, so a clock problem never fails it.
  try { await applyClockForVisit(admin, { visit, action: body.action, when }); } catch (e) { console.error('job clock:', e.message); }

  // When the whole job is finished: move a recurring plan to its next date and send the care instructions.
  // Neither can make the finish fail.
  if (plan.touchCustomerLastVisit && plan.jobPatch.status === 'completed') {
    try {
      const [{ data: plans }, { data: st }] = await Promise.all([
        admin.from('service_plans').select('id,status,next_due,interval_months').eq('customer_id', job.customer_id).eq('status', 'active'),
        admin.from('settings').select('timezone,aftercare_auto').eq('id', 1).maybeSingle(),
      ]);
      for (const p of plans || []) {
        const next = advancePlan(p, plan.touchCustomerLastVisit, st?.timezone || undefined);
        if (next) await admin.from('service_plans').update({ next_due: next }).eq('id', p.id);
      }
      // Care instructions and the customer page are for carpet; restoration jobs are not texted automatically.
      const { data: svc } = await admin.from('jobs').select('service,job_type').eq('id', job.id).maybeSingle();
      const carpetJob = !svc?.service ? svc?.job_type !== 'water_restoration' : svc.service === 'carpet';
      if (st?.aftercare_auto !== false && carpetJob) await sendAftercare({ admin, jobId: job.id, origin: siteUrl(request) });
    } catch {
      /* the visit is already saved */
    }
  }

  return NextResponse.json({ ok: true, visit: updated, jobStatus: plan.jobPatch.status });
}
