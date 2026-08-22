const LOGO_PUBLIC_URL = 'https://jobs.mcloudconstruction.com/mcloud-logo.png';
const PORTAL_URL = 'https://jobs.mcloudconstruction.com/customerportal';
const SUB_PORTAL_URL = 'https://jobs.mcloudconstruction.com/sub-portal';
const BRAND_BROWN = '#7d5a2e';

const DOC_TYPE_COPY = {
  proposal: { subject: 'You have a new estimate', title: 'New Estimate', body: 'a new estimate' },
  contract: { subject: 'You have a new contract', title: 'New Contract', body: 'a new contract' },
  invoice: { subject: 'You have a new invoice', title: 'New Invoice', body: 'a new invoice' },
  'project update': { subject: 'You have a new progress update', title: 'Project Update', body: 'a new progress update' },
  'change order': { subject: 'You have a new change order', title: 'New Change Order', body: 'a new change order' },
  'material selection': { subject: 'A material selection needs your input', title: 'Material Selection', body: 'a material selection to review and choose from' },
};

export function buildDocEmail({ customerName, docType }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const copy = DOC_TYPE_COPY[docType] || { subject: 'You have a new document', title: 'New Document', body: `a new ${docType}` };
  const subject = `${copy.subject} from McLoud Construction`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">${copy.title}</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, we've added ${copy.body} to your project. Click below to securely sign in and review it, download a copy, or ask us any questions.
      </p>
      <a href="${PORTAL_URL}" style="display: inline-block; background: ${BRAND_BROWN}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        View My Project
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        Sign in with the email address this message was sent to. Reach out if anything doesn't look right or you have questions about the project.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `${copy.title}\n\nHi ${firstName}, we've added ${copy.body} to your project. Sign in at jobs.mcloudconstruction.com/customerportal using the email address this message was sent to, to review it, download a copy, or ask us any questions.\n\nReach out if anything doesn't look right.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildNewWorkOrderEmail({ companyName, description, projectAddress }) {
  const subject = 'New work order to review — McLoud Construction';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">New Work Order</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 10px;">
        Hi ${companyName || 'there'}, a new work order is ready for your review${projectAddress ? ` at ${projectAddress}` : ''}.
      </p>
      ${description ? `<p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">${description}</p>` : ''}
      <a href="${SUB_PORTAL_URL}" style="display: inline-block; background: ${BRAND_BROWN}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Review Work Order
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        Sign in with the email address this message was sent to.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `New Work Order\n\nHi ${companyName || 'there'}, a new work order is ready for your review${projectAddress ? ` at ${projectAddress}` : ''}.\n${description || ''}\n\nSign in at jobs.mcloudconstruction.com/sub-portal using the email address this message was sent to.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildFollowupEmail({ contactName, project }) {
  const firstName = (contactName || 'there').split(' ')[0];
  const subject = 'Following up — McLoud Construction';
  const projectLine = project ? ` about ${project}` : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Just checking in</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 20px;">
        Hi ${firstName}, wanted to follow up on our conversation${projectLine}. No pressure at all — just let us know if you have any questions or if you'd like to move forward.
      </p>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 4px;">
        Kind Regards,<br>Stachys — McLoud Construction
      </p>
    </div>
  `;

  const text = `Just checking in\n\nHi ${firstName}, wanted to follow up on our conversation${projectLine}. No pressure at all — just let us know if you have any questions or if you'd like to move forward.\n\nKind Regards,\nStachys — McLoud Construction`;

  return { subject, html, text };
}

export function buildScheduleReminderEmail({ customerName, projectAddress, scheduledStartDate, daysOut }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const dateLabel = new Date(scheduledStartDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = daysOut === 1
    ? `Your project starts tomorrow — McLoud Construction`
    : `Your project starts in a week — McLoud Construction`;
  const heading = daysOut === 1 ? 'Starting Tomorrow' : 'Starting Next Week';
  const timeframe = daysOut === 1 ? 'tomorrow' : 'in one week';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">${heading}</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, just a reminder that work on your project${projectAddress ? ` at ${projectAddress}` : ''} is scheduled to begin ${timeframe}, on ${dateLabel}. Click below to check your project details, or reach out if anything's changed on your end.
      </p>
      <a href="${PORTAL_URL}" style="display: inline-block; background: ${BRAND_BROWN}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        View My Project
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `${heading}\n\nHi ${firstName}, just a reminder that work on your project${projectAddress ? ` at ${projectAddress}` : ''} is scheduled to begin ${timeframe}, on ${dateLabel}. Sign in at jobs.mcloudconstruction.com/customerportal to check your project details, or reach out if anything's changed.\n\nMcLoud Construction`;

  return { subject, html, text };
}
