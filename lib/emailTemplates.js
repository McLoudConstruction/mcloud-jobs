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
      <p>We've added ${copy.body} to your project in the McLoud Construction customer portal. You can review it, download a copy, and ask us any questions directly from there.</p>
      <p>To view it, sign in at <a href="${PORTAL_URL}" style="color: #8a3d14;">jobs.mcloudconstruction.com/portal</a> using the email address this message was sent to.</p>
      <p>Please reach out if anything doesn't look right or you have questions about the project.</p>
      <p>Kind Regards,<br>
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:48px; width:auto; margin-top:6px;" />
      </p>
    </div>
  `;

  const text = `Dear ${firstName},\n\nWe've added ${copy.body} to your project in the McLoud Construction customer portal. You can review it, download a copy, and ask us any questions directly from there.\n\nTo view it, sign in at jobs.mcloudconstruction.com/portal using the email address this message was sent to.\n\nPlease reach out if anything doesn't look right or you have questions about the project.\n\nKind Regards,\nMcLoud Construction`;

  return { subject, html, text };
}
