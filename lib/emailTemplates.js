const LOGO_PUBLIC_URL = 'https://jobs.mcloudconstruction.com/mcloud-logo.png';
const PORTAL_URL = 'https://jobs.mcloudconstruction.com/portal';

const DOC_TYPE_COPY = {
  proposal: { subject: 'You have a new proposal', body: 'a new proposal' },
  contract: { subject: 'You have a new contract', body: 'a new contract' },
  invoice: { subject: 'You have a new invoice', body: 'a new invoice' },
  'project update': { subject: 'You have a new progress update', body: 'a new progress update' },
  'change order': { subject: 'You have a new change order', body: 'a new change order' },
};

export function buildDocEmail({ customerName, docType }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const copy = DOC_TYPE_COPY[docType] || { subject: 'You have a new document', body: `a new ${docType}` };
  const subject = `${copy.subject} from McLoud Construction`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #221f16; line-height: 1.6;">
      <p>Dear ${firstName},</p>
      <p>You have ${copy.body} ready to view from McLoud Construction.</p>
      <p>
        <a href="${PORTAL_URL}" style="display: inline-block; background: #8a3d14; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 5px; font-weight: 600; margin: 8px 0 16px;">
          View in Customer Portal
        </a>
      </p>
      <p>Please let us know if you have any questions.</p>
      <p>Kind Regards,<br>
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:48px; width:auto; margin-top:6px;" />
      </p>
    </div>
  `;

  const text = `Dear ${firstName},\n\nYou have ${copy.body} ready to view from McLoud Construction.\n\nView it in the customer portal: ${PORTAL_URL}\n\nPlease let us know if you have any questions.\n\nKind Regards,\nMcLoud Construction`;

  return { subject, html, text };
}
