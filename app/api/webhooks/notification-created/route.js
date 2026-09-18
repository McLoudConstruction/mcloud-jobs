import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { sendMail } from '../../../../lib/sendMail';
import { buildOwnerNotificationEmail } from '../../../../lib/emailTemplates';

// Fired by a Postgres trigger (migration 111) the instant a row lands in
// `notifications` — from ANY of the ~9 places in the app that create one,
// including future ones, without each having to remember to send an
// email itself. A webhook rather than a new Vercel Cron job: this
// project is already at its 2-cron cap on the Hobby plan (vercel.json),
// and a trigger fires once, immediately, at no cron-slot cost.
//
// Unauthenticated by nature (Supabase can't send a real user session
// token), so it's gated on a shared secret instead — NOTIFICATION_WEBHOOK_SECRET
// must be set to the exact same value here (Vercel env var) and in the
// trigger function migration 111 creates.
export async function POST(request) {
  if (!process.env.NOTIFICATION_WEBHOOK_SECRET) {
    return Response.json({ error: 'NOTIFICATION_WEBHOOK_SECRET is not set.' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.NOTIFICATION_WEBHOOK_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const message = body.message;
  const jobId = body.job_id || null;
  if (!message) return Response.json({ error: 'Missing message.' }, { status: 400 });

  const admin = getAdminClient();
  const { data: settings } = await admin.from('app_settings').select('notification_email').eq('id', 1).maybeSingle();
  const to = settings?.notification_email;
  // Notification emails are opt-in via Settings → Automation — a blank
  // address means "off," not a misconfiguration, so this isn't an error.
  if (!to) return Response.json({ skipped: true, reason: 'No notification_email configured.' });

  let jobNumber = null;
  if (jobId) {
    const { data: job } = await admin.from('jobs').select('job_number').eq('id', jobId).maybeSingle();
    jobNumber = job?.job_number || null;
  }

  try {
    const { subject, html, text } = buildOwnerNotificationEmail({ message, jobNumber });
    await sendMail({ to, subject, html, text, jobId: jobId || undefined });
    return Response.json({ sent: true });
  } catch (err) {
    console.error('Failed to email owner about notification:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
