const LOGO_PUBLIC_URL = 'https://jobs.mcloudconstruction.com/mcloud-logo.png';

export function buildDocEmail({ customerName, docType }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = 'New Message from McLoud Construction';

  const html = `
    <div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #221f16; line-height: 1.6;">
      <p>Dear ${firstName},</p>
      <p>You have a ${docType} ready to view from McLoud Construction.</p>
      <p>Please let us know if you have any questions.</p>
      <p>Kind Regards,<br>
      <img src="${LOGO_PUBLIC_URL}" alt="McLoud Construction" style="height:48px; width:auto; margin-top:6px;" />
      </p>
    </div>
  `;

  const text = `Dear ${firstName},\n\nYou have a ${docType} ready to view from McLoud Construction.\n\nPlease let us know if you have any questions.\n\nKind Regards,\nMcLoud Construction`;

  return { subject, html, text };
}
