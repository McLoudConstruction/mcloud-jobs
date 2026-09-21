const PORTAL_URL = 'https://jobs.mcloudconstruction.com/customerportal';
const SUB_PORTAL_URL = 'https://jobs.mcloudconstruction.com/sub-portal';

// Every template below uses {{LOGO_URL}} and {{BRAND_COLOR}} placeholders
// instead of a hardcoded logo/color — these used to point at a static
// file and a fixed hex that never reflected whatever was actually
// uploaded/set in Settings → Branding. sendMail() (lib/sendMail.js) fills
// them in right before sending, from the live app_settings row, falling
// back to the same McLoud brown/logo these constants used to hardcode if
// nothing's configured yet. Keep using these two tokens in any new
// template rather than a literal URL or hex.

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
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">${copy.title}</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, we've added ${copy.body} to your project. Click below to securely sign in and review it, download a copy, or ask us any questions.
      </p>
      <a href="${PORTAL_URL}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
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
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">New Work Order</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 10px;">
        Hi ${companyName || 'there'}, a new work order is ready for your review${projectAddress ? ` at ${projectAddress}` : ''}.
      </p>
      ${description ? `<p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">${description}</p>` : ''}
      <a href="${SUB_PORTAL_URL}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
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

export function buildRfpEmail({ companyName, title, description, projectAddress }) {
  const subject = `New request for proposal — ${title} — McLoud Construction`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">New Request for Proposal</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 10px;">
        Hi ${companyName || 'there'}, McLoud Construction would like a proposal from you for <strong>${title}</strong>${projectAddress ? ` at ${projectAddress}` : ''}.
      </p>
      ${description ? `<p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">${description}</p>` : ''}
      <p style="font-size: 12.5px; color: #8a8471; line-height: 1.6; margin: 0 0 26px;">
        This is a request for a bid, not an assigned job — nothing is committed until it's awarded.
      </p>
      <a href="${SUB_PORTAL_URL}/rfps" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Review &amp; Submit Proposal
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        Sign in with the email address this message was sent to.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `New Request for Proposal\n\nHi ${companyName || 'there'}, McLoud Construction would like a proposal from you for ${title}${projectAddress ? ` at ${projectAddress}` : ''}.\n${description || ''}\n\nThis is a request for a bid, not an assigned job — nothing is committed until it's awarded.\n\nSign in at jobs.mcloudconstruction.com/sub-portal/rfps using the email address this message was sent to.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildSubApplicationApprovedEmail({ companyName }) {
  const subject = "You're approved — let's get to work!";
  const greeting = companyName ? `Hi ${companyName} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">You've Been Approved!</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        ${greeting} great news — your subcontractor application has been approved. We're excited to work with you.
        You're now set up in our system, and we'll be in touch as soon as we have a project that's a good fit.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `You've Been Approved!\n\n${greeting} great news — your subcontractor application has been approved. We're excited to work with you. You're now set up in our system, and we'll be in touch as soon as we have a project that's a good fit.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildSubApplicationDeclinedEmail({ companyName, reason }) {
  const subject = 'Update on your subcontractor application';
  const greeting = companyName ? `Hi ${companyName} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Thanks for Applying</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 18px;">
        ${greeting} thank you for taking the time to apply. After review, we don't think we're the best fit right now.
      </p>
      ${reason ? `<p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;"><b>Reason:</b> ${reason}</p>` : ''}
      <p style="font-size: 13px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        We appreciate your interest and encourage you to reach back out if your circumstances change.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Thanks for Applying\n\n${greeting} thank you for taking the time to apply. After review, we don't think we're the best fit right now.\n${reason ? `\nReason: ${reason}\n` : ''}\nWe appreciate your interest and encourage you to reach back out if your circumstances change.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildSubInviteEmail({ applyUrl, companyHint }) {
  const subject = 'You\'re invited to submit your subcontractor documentation — McLoud Construction';
  const greeting = companyHint ? `Hi ${companyHint} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Subcontractor Application</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        ${greeting} McLoud Construction would like to get you set up as a subcontractor. Click below to submit your company
        information along with your W9 and Certificate of Insurance — it only takes a few minutes, and there's no account or
        password needed.
      </p>
      <a href="${applyUrl}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Submit My Information
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        This link is unique to you — please don't forward it. Reach out if you have any questions.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Subcontractor Application\n\n${greeting} McLoud Construction would like to get you set up as a subcontractor. Use the link below to submit your company information along with your W9 and Certificate of Insurance — it only takes a few minutes, and there's no account or password needed.\n\n${applyUrl}\n\nThis link is unique to you — please don't forward it.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildFollowupEmail({ contactName, project }) {
  const firstName = (contactName || 'there').split(' ')[0];
  const subject = 'Following up — McLoud Construction';
  const projectLine = project ? ` about ${project}` : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
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

export function buildProposalFollowupEmail({ customerName, jobType, followupNumber }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = 'Following up on your estimate — McLoud Construction';
  const projectLine = jobType ? ` for your ${jobType.toLowerCase()} project` : '';
  // The wording stays the same regardless of which follow-up in the
  // sequence this is (1st, 2nd, 3rd...) — a customer only ever sees one
  // of these at a time, so numbering it for them would just read oddly.
  // followupNumber is accepted for callers that want to log/branch on it.

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Just checking in on your estimate</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 20px;">
        Hi ${firstName}, wanted to follow up on the estimate we sent you${projectLine}. No pressure at all — just let us know if you have any questions, or if you'd like to move forward.
      </p>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 4px;">
        Kind Regards,<br>Stachys — McLoud Construction
      </p>
    </div>
  `;

  const text = `Just checking in on your estimate\n\nHi ${firstName}, wanted to follow up on the estimate we sent you${projectLine}. No pressure at all — just let us know if you have any questions, or if you'd like to move forward.\n\nKind Regards,\nStachys — McLoud Construction`;

  return { subject, html, text };
}

export function buildReviewRequestEmail({ customerName, reviewUrl }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = 'Would you mind leaving us a review?';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Thank You!</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, it was a pleasure working on your project. If you have a minute, a quick Google review
        would mean a lot to us and helps other homeowners find us.
      </p>
      <a href="${reviewUrl}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Leave a Google Review
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        Thanks again for choosing McLoud Construction.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Thank You!\n\nHi ${firstName}, it was a pleasure working on your project. If you have a minute, a quick Google review would mean a lot to us and helps other homeowners find us.\n\n${reviewUrl}\n\nThanks again for choosing McLoud Construction.`;

  return { subject, html, text };
}

// portalLabel lets this same "here's a sign-in link" template serve both
// the customer portal (default) and the Sub Portal's own self-service
// "Email me a link" button (see /api/portal/magic-link) without a second
// near-identical template to maintain.
export function buildPortalInviteEmail({ customerName, actionLink, portalLabel = 'project portal' }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = `Your McLoud Construction ${portalLabel}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Your Sign-In Link</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, click below to sign in to your McLoud Construction ${portalLabel} — everything about your
        project lives there in one place.
      </p>
      <a href="${actionLink}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Sign In to My Portal
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        This link is unique to you and expires soon — if it's stopped working, just ask us to resend it.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Your Sign-In Link\n\nHi ${firstName}, sign in to your McLoud Construction ${portalLabel} here:\n\n${actionLink}\n\nThis link is unique to you and expires soon — if it's stopped working, just ask us to resend it.\n\nMcLoud Construction`;

  return { subject, html, text };
}

// Sent for a customer's FIRST-ever portal invite, before they have any
// account at all — distinct from buildPortalInviteEmail, which is a plain
// "sign in" link for someone already set up. This one frames the action as
// account creation and states the expiry concretely, since a customer who
// hasn't used the portal before has no context for what a stale link means.
export function buildPortalActivationEmail({ customerName, actionLink }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = 'Set up your McLoud Construction project portal';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Set Up Your Project Portal</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, McLoud Construction has set up a project portal for you — everything about your project
        (estimates, contracts, updates, and invoices) lives there in one place. Click below to create your account
        and set a password.
      </p>
      <a href="${actionLink}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Set Up My Account
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        This link is unique to you and expires in 7 days — if it's stopped working, just ask us to resend it.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Set Up Your Project Portal\n\nHi ${firstName}, McLoud Construction has set up a project portal for you. Create your account here:\n\n${actionLink}\n\nThis link is unique to you and expires in 7 days — if it's stopped working, just ask us to resend it.\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildStaffInviteEmail({ fullName, roleLabel, actionLink }) {
  const firstName = (fullName || 'there').split(' ')[0];
  const subject = 'Your McLoud Jobs staff account';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">You're Invited</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 10px;">
        Hi ${firstName}, you've been added to McLoud Jobs as a <strong>${roleLabel}</strong>. Click below to set your
        password and sign in.
      </p>
      <a href="${actionLink}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px; margin-top: 16px;">
        Set Up My Account
      </a>
      <p style="font-size: 12px; color: #8a8471; line-height: 1.6; margin: 26px 0 4px;">
        This link is unique to you and expires soon — if it's stopped working, ask an owner to resend your invite.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `You're Invited\n\nHi ${firstName}, you've been added to McLoud Jobs as a ${roleLabel}. Set up your account here:\n\n${actionLink}\n\nThis link is unique to you and expires soon — if it's stopped working, ask an owner to resend your invite.\n\nMcLoud Construction`;

  return { subject, html, text };
}

// Sent to the owner (Settings → Automation → "Send to") the moment a
// notification-level event happens anywhere in the app — a contract
// signed, a work order accepted, and similar. Deliberately plain: this is
// an internal alert, not a customer-facing message, so it skips the
// portal-link button the other templates have and just states the event.
export function buildOwnerNotificationEmail({ message, jobNumber }) {
  const subject = jobNumber ? `[Job #${jobNumber}] ${message}` : message;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">New Notification</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 8px;">${message}</p>
      ${jobNumber ? `<p style="font-size: 12.5px; color: #8a8471; margin: 0 0 26px;">Job #${jobNumber}</p>` : ''}
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">
        McLoud Jobs — sent because a notification-level event happened on the platform. Change or turn off this
        email in Settings → Automation.
      </p>
    </div>
  `;

  const text = `New Notification\n\n${message}${jobNumber ? `\n\nJob #${jobNumber}` : ''}\n\nMcLoud Jobs — sent because a notification-level event happened on the platform. Change or turn off this email in Settings → Automation.`;

  return { subject, html, text };
}

// Sent the moment a subcontractor application hits the public apply
// form (app/api/public/subcontractor-application/route.js) — separate
// from buildSubApplicationApprovedEmail/DeclinedEmail, which come later
// once the office actually reviews it. This one just confirms receipt so
// an applicant isn't left wondering whether the form worked.
export function buildSubApplicationReceivedEmail({ companyName }) {
  const subject = "We've received your application — McLoud Construction";
  const greeting = companyName ? `Hi ${companyName} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Application Received</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        ${greeting} thanks for applying to work with McLoud Construction. We've received your information and will
        get back to you soon.
      </p>
      <p style="font-size: 12px; color: #8a8471; margin: 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Application Received\n\n${greeting} thanks for applying to work with McLoud Construction. We've received your information and will get back to you soon.\n\nMcLoud Construction`;

  return { subject, html, text };
}

// portalUrl/portalLabel let one template cover all three inboxes a
// "you have a message" notification can go to — the office doesn't get
// this one (their existing bell already covers it), so this only ever
// renders for a customer or a subcontractor.
export function buildMessageReceivedEmail({ recipientName, senderLabel, portalUrl, portalLabel }) {
  const firstName = (recipientName || 'there').split(' ')[0];
  const subject = `New message from ${senderLabel}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">New Message</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, you received a new message from ${senderLabel}. Visit your ${portalLabel} to see it.
      </p>
      <a href="${portalUrl}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        View Message
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `New Message\n\nHi ${firstName}, you received a new message from ${senderLabel}. Visit your ${portalLabel} to see it:\n\n${portalUrl}\n\nMcLoud Construction`;

  return { subject, html, text };
}

export function buildRfpAwardedEmail({ companyName, rfpTitle, projectAddress }) {
  const subject = `You've been awarded "${rfpTitle}"`;
  const greeting = companyName ? `Hi ${companyName} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">You've Been Awarded the Job</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        ${greeting} congratulations — you've been awarded <strong>${rfpTitle}</strong>${projectAddress ? ` at ${projectAddress}` : ''}.
        Visit your Sub Portal for next steps.
      </p>
      <a href="${SUB_PORTAL_URL}/rfps" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        View in Sub Portal
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `You've Been Awarded the Job\n\n${greeting} congratulations — you've been awarded ${rfpTitle}${projectAddress ? ` at ${projectAddress}` : ''}. Visit your Sub Portal for next steps:\n\n${SUB_PORTAL_URL}/rfps\n\nMcLoud Construction`;

  return { subject, html, text };
}

// One-time nudge for an RFP recipient who hasn't submitted a proposal
// yet — fired by the daily cron's RFP reminder block (see
// /api/cron/daily-automations), via a portal_notifications insert that
// the notification-created webhook turns into this email, same fan-out
// as buildRfpAwardedEmail above.
export function buildRfpReminderEmail({ companyName, rfpTitle, projectAddress }) {
  const subject = `Reminder: proposal requested for "${rfpTitle}"`;
  const greeting = companyName ? `Hi ${companyName} team,` : 'Hi there,';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Proposal Reminder</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        ${greeting} just a quick reminder to submit your proposal for <strong>${rfpTitle}</strong>${projectAddress ? ` at ${projectAddress}` : ''} — this is still an open opportunity.
      </p>
      <a href="${SUB_PORTAL_URL}/rfps" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Review &amp; Submit Proposal
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Proposal Reminder\n\n${greeting} just a quick reminder to submit your proposal for ${rfpTitle}${projectAddress ? ` at ${projectAddress}` : ''} — this is still an open opportunity.\n\n${SUB_PORTAL_URL}/rfps\n\nMcLoud Construction`;

  return { subject, html, text };
}

// Fires right away off the Stripe payment_intent.payment_failed webhook
// — the point is the customer hears about a failed payment as soon as
// the app itself knows, rather than only finding out when the invoice
// is still showing due later.
export function buildPaymentFailedEmail({ customerName, projectAddress, declineReason }) {
  const firstName = (customerName || 'there').split(' ')[0];
  const subject = 'Your payment could not be processed';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">Payment Not Successful</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 10px;">
        Hi ${firstName}, we weren't able to process your recent payment${projectAddress ? ` for your project at ${projectAddress}` : ''}.
      </p>
      ${declineReason ? `<p style="font-size: 13px; color: #4a4436; line-height: 1.6; margin: 0 0 18px;"><b>Reason given:</b> ${declineReason}</p>` : ''}
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        No action has been taken against your account — please visit your project portal to try again or use a different payment method.
      </p>
      <a href="${PORTAL_URL}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        Try Again
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `Payment Not Successful\n\nHi ${firstName}, we weren't able to process your recent payment${projectAddress ? ` for your project at ${projectAddress}` : ''}.${declineReason ? `\n\nReason given: ${declineReason}` : ''}\n\nPlease visit your project portal to try again or use a different payment method:\n\n${PORTAL_URL}\n\nMcLoud Construction`;

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
      <img src="{{LOGO_URL}}" alt="McLoud Construction" style="height:44px; width:auto; margin-bottom: 28px;" />
      <h1 style="font-size: 21px; font-weight: 700; color: #221f16; margin: 0 0 14px;">${heading}</h1>
      <p style="font-size: 14px; color: #4a4436; line-height: 1.6; margin: 0 0 26px;">
        Hi ${firstName}, just a reminder that work on your project${projectAddress ? ` at ${projectAddress}` : ''} is scheduled to begin ${timeframe}, on ${dateLabel}. Click below to check your project details, or reach out if anything's changed on your end.
      </p>
      <a href="${PORTAL_URL}" style="display: inline-block; background: {{BRAND_COLOR}}; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 26px; border-radius: 6px;">
        View My Project
      </a>
      <p style="font-size: 12px; color: #8a8471; margin: 26px 0 0;">McLoud Construction</p>
    </div>
  `;

  const text = `${heading}\n\nHi ${firstName}, just a reminder that work on your project${projectAddress ? ` at ${projectAddress}` : ''} is scheduled to begin ${timeframe}, on ${dateLabel}. Sign in at jobs.mcloudconstruction.com/customerportal to check your project details, or reach out if anything's changed.\n\nMcLoud Construction`;

  return { subject, html, text };
}
