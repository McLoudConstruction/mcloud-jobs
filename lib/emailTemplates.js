const LOGO_PUBLIC_URL = 'https://jobs.mcloudconstruction.com/mcloud-logo.png';
const PORTAL_URL = 'https://jobs.mcloudconstruction.com/portal';
const BRAND_BROWN = '#7d5a2e';

const DOC_TYPE_COPY = {
  proposal: { subject: 'You have a new proposal', title: 'New Proposal', body: 'a new proposal' },
  contract: { subject: 'You have a new contract', title: 'New Contract', body: 'a new contract' },
  invoice: { subject: 'You have a new invoice', title: 'New Invoice', body: 'a new invoice' },
  'project update': { subject: 'You have a new progress update', title: 'Project Update', body: 'a new progress update' },
  'change order': { subject: 'You have a new change order', title: 'New Change Order', body: 'a new change order' },
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

  const text = `${copy.title}\n\nHi ${firstName}, we've added ${copy.body} to your project. Sign in at jobs.mcloudconstruction.com/portal using the email address this message was sent to, to review it, download a copy, or ask us any questions.\n\nReach out if anything doesn't look right.\n\nMcLoud Construction`;

  return { subject, html, text };
}
