import { createClient } from '@supabase/supabase-js';
import { buildFollowupEmail, buildScheduleReminderEmail } from '../../../../lib/emailTemplates';
import nodemailer from 'nodemailer';

// Uses the service role key, not the public anon key — this route runs on
// a schedule with no logged-in user, so RLS (which requires a session)
// would otherwise block every query. Never expose this key client-side.
function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getTransporter() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

async function sendMail(transporter, { to, subject, html, text }) {
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html, text });
}

function daysBetween(dateStr, today) {
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  const diffMs = new Date(today.toDateString()) - new Date(d.toDateString());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export async function GET(request) {
  // Vercel Cron sends this header automatically; also accept a manual
  // Bearer token so this can be triggered by hand for testing.
  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' }, { status: 500 });
  }
  if (!process.env.SMTP_HOST) {
    return Response.json({ error: 'SMTP is not configured.' }, { status: 500 });
  }

  const supabase = getAdminClient();
  const transporter = getTransporter();
  const today = new Date();
  const results = { followups_sent: 0, reminders_sent: 0, skipped_opted_out: 0, errors: [] };

  async function isOptedOut(email) {
    if (!email) return false;
    const { data } = await supabase.from('contacts').select('automated_emails_opt_out').eq('contact_email', email).maybeSingle();
    return data?.automated_emails_opt_out === true;
  }

  // ── Opportunity follow-ups: 2 days and 4 days after date_taken ──
  try {
    const { data: opps } = await supabase
      .from('opportunities')
      .select('*')
      .in('stage', ['prospecting', 'contacted'])
      .not('contact_email', 'is', null);

    for (const opp of opps || []) {
      if (!opp.date_taken) continue;
      const days = daysBetween(opp.date_taken, today);

      const due = [];
      if (days === 2 && !opp.followup_2d_sent_at) due.push('followup_2d_sent_at');
      if (days === 4 && !opp.followup_4d_sent_at) due.push('followup_4d_sent_at');
      if (due.length === 0) continue;

      if (await isOptedOut(opp.contact_email)) {
        results.skipped_opted_out++;
        continue;
      }

      try {
        const { subject, html, text } = buildFollowupEmail({ contactName: opp.contact_name, project: opp.project });
        await sendMail(transporter, { to: opp.contact_email, subject, html, text });
        const patch = {};
        due.forEach(field => { patch[field] = new Date().toISOString(); });
        await supabase.from('opportunities').update(patch).eq('id', opp.id);
        results.followups_sent++;
      } catch (err) {
        results.errors.push(`Opportunity ${opp.id}: ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Follow-up query failed: ${err.message}`);
  }

  // ── Schedule reminders: configurable per job via schedule_reminder_days ──
  try {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .not('scheduled_start_date', 'is', null)
      .not('customer_email', 'is', null);

    for (const job of jobs || []) {
      const daysOut = -daysBetween(job.scheduled_start_date, today); // positive = in the future
      const reminderDays = job.schedule_reminder_days || [7, 1];
      const alreadySent = job.schedule_reminders_sent || [];

      if (!reminderDays.includes(daysOut) || alreadySent.includes(daysOut)) continue;

      if (await isOptedOut(job.customer_email)) {
        results.skipped_opted_out++;
        continue;
      }

      try {
        const { subject, html, text } = buildScheduleReminderEmail({
          customerName: job.customer_name,
          projectAddress: job.project_address,
          scheduledStartDate: job.scheduled_start_date,
          daysOut,
        });
        await sendMail(transporter, { to: job.customer_email, subject, html, text });
        await supabase.from('jobs').update({ schedule_reminders_sent: [...alreadySent, daysOut] }).eq('id', job.id);
        results.reminders_sent++;
      } catch (err) {
        results.errors.push(`Job ${job.id}: ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Reminder query failed: ${err.message}`);
  }

  return Response.json(results);
}
