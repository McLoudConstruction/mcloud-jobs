import { createClient } from '@supabase/supabase-js';
import { buildFollowupEmail, buildScheduleReminderEmail, buildProposalFollowupEmail } from '../../../../lib/emailTemplates';
import { sendMail as dispatchMail } from '../../../../lib/sendMail';
import { logCommunication } from '../../../../lib/logCommunication';
import { phaseForStage } from '../../../../lib/constants';
import { tagSubjectWithJob } from '../../../../lib/emailThreading';
import { syncConnectionEmail } from '../../../../lib/integrations/emailSync';
import { workdayOnOrAfter } from '../../../../lib/scheduleDates';

// Uses the service role key, not the public anon key — this route runs on
// a schedule with no logged-in user, so RLS (which requires a session)
// would otherwise block every query. Never expose this key client-side.
function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Kept as a local wrapper (same name every call site below already
// uses) but now dispatches through dispatchMail() — Resend when
// configured, SMTP as a fallback — instead of a hand-rolled SMTP-only
// nodemailer transporter, so there's no longer a transporter to pass
// in. Subject is tagged with the job number here (jobNumber is already
// on hand from each query below, avoiding an extra DB round-trip)
// rather than passing jobId through to dispatchMail(), which would tag
// it a second time.
async function sendMail({ to, subject, html, text, category, jobId, jobNumber }) {
  const taggedSubject = jobNumber ? tagSubjectWithJob(subject, jobNumber) : subject;
  try {
    const { provider } = await dispatchMail({ to, subject: taggedSubject, html, text });
    await logCommunication({ category, toEmail: to, subject: taggedSubject, jobId: jobId || null, sentBy: 'system (daily automation)', status: 'sent', provider });
  } catch (err) {
    await logCommunication({ category, toEmail: to, subject: taggedSubject, jobId: jobId || null, sentBy: 'system (daily automation)', status: 'failed', errorMessage: err.message, provider: 'unknown' });
    throw err;
  }
}

function daysBetween(dateStr, today) {
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  const diffMs = new Date(today.toDateString()) - new Date(d.toDateString());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// Calendar-day add on a full timestamptz or YYYY-MM-DD string, returned
// as YYYY-MM-DD — used below to turn an RFP's created_at into "2 weeks
// from RFP entry date" for the open-ended case.
function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

  const supabase = getAdminClient();
  const today = new Date();
  const results = { followups_sent: 0, reminders_sent: 0, proposal_followups_sent: 0, skipped_opted_out: 0, errors: [] };

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
        await sendMail({ to: opp.contact_email, subject, html, text, category: 'opportunity_followup' });
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
        await sendMail({ to: job.customer_email, subject, html, text, category: 'schedule_reminder', jobId: job.id, jobNumber: job.job_number });
        await supabase.from('jobs').update({ schedule_reminders_sent: [...alreadySent, daysOut] }).eq('id', job.id);
        results.reminders_sent++;
      } catch (err) {
        results.errors.push(`Job ${job.id}: ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Reminder query failed: ${err.message}`);
  }

  // ── Proposal follow-ups: fires while a job's proposal has been sent
  // but the job hasn't been won (converted) or lost yet, up to a
  // configurable count at a configurable interval (Settings page). This
  // is separate from the opportunity 2d/4d follow-up above — that one
  // covers early-stage leads before a proposal ever goes out.
  try {
    const { data: appSettings } = await supabase.from('app_settings').select('proposal_followup_count, proposal_followup_interval_days').eq('id', 1).single();
    const followupCount = appSettings?.proposal_followup_count ?? 3;
    const intervalDays = appSettings?.proposal_followup_interval_days ?? 4;

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, job_number, stage, job_type, customer_email, billing_email, customer_name, proposal_sent_at, proposal_followups_sent_count, proposal_followup_last_sent_at')
      .not('proposal_sent_at', 'is', null)
      .lt('proposal_followups_sent_count', followupCount);

    for (const job of jobs || []) {
      if (phaseForStage(job.stage) !== 'opportunity' || job.stage === 'lost') continue; // won (converted past opportunity) or lost — no more follow-ups either way

      const lastAt = job.proposal_followup_last_sent_at || job.proposal_sent_at;
      const daysSinceLast = daysBetween(lastAt, today);
      if (daysSinceLast < intervalDays) continue;

      const recipient = job.billing_email || job.customer_email;
      if (!recipient) continue;

      if (await isOptedOut(recipient)) {
        results.skipped_opted_out++;
        continue;
      }

      try {
        const nextCount = (job.proposal_followups_sent_count || 0) + 1;
        const { subject, html, text } = buildProposalFollowupEmail({ customerName: job.customer_name, jobType: job.job_type, followupNumber: nextCount });
        await sendMail({ to: recipient, subject, html, text, category: 'proposal_followup', jobId: job.id, jobNumber: job.job_number });
        await supabase.from('jobs').update({
          proposal_followups_sent_count: nextCount,
          proposal_followup_last_sent_at: new Date().toISOString(),
        }).eq('id', job.id);
        results.proposal_followups_sent++;
      } catch (err) {
        results.errors.push(`Job ${job.id}: ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Proposal follow-up query failed: ${err.message}`);
  }

  // ── RFP proposal reminders: one nudge per recipient, on the next
  // workday on/after the RFP's due date. Due date is the staff-set
  // Expected By date, or 2 weeks (14 calendar days) after the RFP was
  // created when left open-ended (migration 128). Only recipients who
  // haven't responded yet get one, and only once ever per recipient.
  // Sent as a portal_notifications row rather than a direct email —
  // its own AFTER INSERT trigger both emails the recipient (via
  // buildRfpReminderEmail, wired up in the notification-created
  // webhook) and lights up their Sub Portal bell, same fan-out already
  // used for "you were awarded this RFP".
  try {
    const { data: rfps } = await supabase
      .from('rfps')
      .select('id, job_id, title, expected_by, created_at, rfp_recipients(id, company_id, status, reminder_sent_at)')
      .eq('status', 'open');

    const todayStr = today.toISOString().slice(0, 10);
    results.rfp_reminders_sent = 0;

    for (const rfp of rfps || []) {
      const dueDate = rfp.expected_by || addCalendarDays(rfp.created_at, 14);
      const reminderDate = workdayOnOrAfter(dueDate);
      if (todayStr < reminderDate) continue;

      for (const recipient of rfp.rfp_recipients || []) {
        if (recipient.reminder_sent_at) continue;
        if (!['sent', 'viewed'].includes(recipient.status)) continue; // already responded, awarded, or not_awarded

        try {
          const { error: notifyError } = await supabase.from('portal_notifications').insert({
            recipient_kind: 'subcontractor',
            company_id: recipient.company_id,
            job_id: rfp.job_id,
            category: 'rfp_reminder',
            message: `Just a quick reminder to submit your proposal for "${rfp.title}".`,
            link_path: '/sub-portal/rfps',
            source_id: rfp.id,
          });
          if (notifyError) throw notifyError;
          await supabase.from('rfp_recipients').update({ reminder_sent_at: new Date().toISOString() }).eq('id', recipient.id);
          results.rfp_reminders_sent++;
        } catch (err) {
          results.errors.push(`RFP recipient ${recipient.id}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    results.errors.push(`RFP reminder query failed: ${err.message}`);
  }

  // ── Inbound email sync — folded in here rather than its own cron
  // entry. Hobby-plan Vercel caps cron at 2 jobs total, both daily-only;
  // a separate more-frequent schedule for this exceeded both limits at
  // once. Runs once a day, same as everything else in this route, and
  // /api/cron/sync-email still exists standalone for a manual/admin
  // trigger if a faster check is ever needed by hand.
  try {
    const { data: connections } = await supabase
      .from('integration_connections')
      .select('*')
      .in('provider', ['google', 'microsoft']);
    results.email_synced = 0;
    for (const connection of connections || []) {
      try {
        const { synced } = await syncConnectionEmail(connection);
        results.email_synced += synced || 0;
      } catch (err) {
        results.errors.push(`Email sync (${connection.provider}, staff ${connection.staff_id}): ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Email sync query failed: ${err.message}`);
  }

  return Response.json(results);
}
