import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { applyBlackoutToSchedule } from '../../../../lib/blackoutShift';

// Customer blackout dates (migration 142).
//
// The customer's own session records the request through the
// add_customer_blackout() database function, which does every permission and
// date check (portal access on this job, contract signed, future dates,
// notice period). If the request came with enough notice it is
// 'auto_applied', and this route — using the service role, because a customer
// is never allowed to edit the schedule directly — shifts the published
// schedule around the blackout right away. Anything shorter comes back as
// 'needs_review' and the schedule is left alone until staff approve it.
export async function POST(request) {
  try {
    const { accessToken, jobId, startDate, endDate, reason } = await request.json();
    if (!accessToken || !jobId || !startDate || !endDate) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    const asCustomer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: userErr } = await asCustomer.auth.getUser();
    if (userErr || !user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });

    const { data, error } = await asCustomer.rpc('add_customer_blackout', {
      target_job_id: jobId, start_in: startDate, end_in: endDate, reason_in: reason || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const created = Array.isArray(data) ? data[0] : data;

    let scheduleNote = null;
    if (created.status === 'auto_applied') {
      const admin = getAdminClient();
      try {
        const result = await applyBlackoutToSchedule(admin, {
          jobId, blackoutId: created.id, startDate, endDate, actorEmail: `customer: ${user.email}`,
        });
        scheduleNote = result.note;
        await admin.from('customer_blackout_dates').update({ schedule_shift_note: result.note }).eq('id', created.id);
      } catch (shiftErr) {
        // The request itself is saved — flag it for staff instead of failing
        // the customer, and make sure it isn't mistaken for an applied one.
        console.error('Blackout schedule shift failed:', shiftErr.message);
        scheduleNote = `Automatic schedule change failed (${shiftErr.message}) — needs manual review.`;
        await admin.from('customer_blackout_dates').update({ status: 'needs_review', schedule_shift_note: scheduleNote }).eq('id', created.id);
        created.status = 'needs_review';
      }
    }

    return Response.json({ success: true, id: created.id, status: created.status, scheduleNote });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to save blackout dates.' }, { status: 500 });
  }
}
