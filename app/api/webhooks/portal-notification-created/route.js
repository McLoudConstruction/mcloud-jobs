import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { sendMail } from '../../../../lib/sendMail';
import { logCommunication } from '../../../../lib/logCommunication';
import { buildMessageReceivedEmail, buildRfpAwardedEmail, buildRfpReminderEmail, buildPaymentFailedEmail } from '../../../../lib/emailTemplates';

const PORTAL_URL = 'https://jobs.mcloudconstruction.com/customerportal';
const SUB_PORTAL_URL = 'https://jobs.mcloudconstruction.com/sub-portal';

// Mirror of /api/webhooks/notification-created (migration 111), but for
// portal_notifications (migration 126) — the customer/sub-facing table.
// Every row there gets emailed unconditionally (no owner_notify-style
// opt-out): unlike an internal staff alert, "you have a message" or
// "you were awarded this RFP" IS the email, not a copy of one.
export async function POST(request) {
  if (!process.env.NOTIFICATION_WEBHOOK_SECRET) {
    return Response.json({ error: 'NOTIFICATION_WEBHOOK_SECRET is not set.' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.NOTIFICATION_WEBHOOK_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { recipient_kind: recipientKind, job_id: jobId, company_id: companyId, category, message, source_id: sourceId, meta } = body;
  if (!recipientKind) return Response.json({ error: 'Missing recipient_kind.' }, { status: 400 });

  const admin = getAdminClient();
  const logCategory = category || 'portal_notification';
  let to = null;
  let payload = null;

  try {
    if (recipientKind === 'customer') {
      if (!jobId) return Response.json({ error: 'Missing job_id for a customer notification.' }, { status: 400 });
      const { data: job } = await admin.from('jobs').select('customer_email, billing_email, customer_name, project_address').eq('id', jobId).maybeSingle();
      to = job?.customer_email || job?.billing_email;
      if (!to) return Response.json({ skipped: true, reason: 'No email on file for this job.' });

      payload = category === 'payment_failed'
        ? buildPaymentFailedEmail({ customerName: job.customer_name, projectAddress: job.project_address, declineReason: meta?.decline_reason || null })
        : buildMessageReceivedEmail({ recipientName: job.customer_name, senderLabel: 'McLoud Construction', portalUrl: PORTAL_URL, portalLabel: 'Customer Portal' });
    } else if (recipientKind === 'subcontractor') {
      if (!companyId) return Response.json({ error: 'Missing company_id for a subcontractor notification.' }, { status: 400 });
      const { data: company } = await admin.from('companies').select('contact_email, company_name').eq('id', companyId).maybeSingle();
      to = company?.contact_email;
      if (!to) return Response.json({ skipped: true, reason: 'No email on file for this company.' });

      if (category === 'rfp_awarded' || category === 'rfp_reminder') {
        let rfpTitle = 'a request for proposal';
        let projectAddress = null;
        if (sourceId) {
          const { data: rfp } = await admin.from('rfps').select('title, jobs(project_address)').eq('id', sourceId).maybeSingle();
          if (rfp?.title) rfpTitle = rfp.title;
          projectAddress = rfp?.jobs?.project_address || null;
        }
        payload = category === 'rfp_awarded'
          ? buildRfpAwardedEmail({ companyName: company.company_name, rfpTitle, projectAddress })
          : buildRfpReminderEmail({ companyName: company.company_name, rfpTitle, projectAddress });
      } else {
        payload = buildMessageReceivedEmail({ recipientName: company.company_name, senderLabel: 'McLoud Construction', portalUrl: SUB_PORTAL_URL, portalLabel: 'Sub Portal' });
      }
    } else {
      return Response.json({ error: `Unknown recipient_kind: ${recipientKind}` }, { status: 400 });
    }

    const { provider } = await sendMail({ to, ...payload, jobId: jobId || undefined });
    await logCommunication({ category: logCategory, toEmail: to, subject: payload.subject, jobId: jobId || null, sentBy: 'system (portal notification)', status: 'sent', provider });
    return Response.json({ sent: true });
  } catch (err) {
    console.error('Failed to email portal notification recipient:', err.message);
    if (to) {
      await logCommunication({ category: logCategory, toEmail: to, subject: payload?.subject || null, jobId: jobId || null, sentBy: 'system (portal notification)', status: 'failed', errorMessage: err.message });
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
