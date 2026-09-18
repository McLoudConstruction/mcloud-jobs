export const SUPPORT_EMAIL = 'info@mcloudconstruction.com';

// Google Business Profile review link — customers land here to leave a
// review with one click.
export const GOOGLE_REVIEW_URL = 'https://g.page/r/CSWyXady1jZxEBM/review';

export const PROSPECT_STAGES = ['prospecting', 'contacted', 'proposal', 'won', 'lost'];
export const PROSPECT_STAGE_LABELS = { prospecting: 'Prospecting', contacted: 'Contacted', proposal: 'Estimate Sent', won: 'Won', lost: 'Lost' };

export const PROPERTY_TYPES = [
  'Multi-Family',
  'Office',
  'Retail',
  'Industrial',
  'Hospitality',
  'Senior Living',
  'Education',
  'Religious - Churches',
  'Government',
  'Residential - Homeowner',
  'Residential - Investor',
];

export const CONTACT_TYPES = [
  'Multi-Family',
  'Commercial',
  'Hospitality',
  'Senior Living',
  'Education',
  'Religious - Churches',
  'Government',
  'Residential - Homeowner',
  'Residential - Investor',
];

// Full project workflow, grouped into three phases (matches the internal
// workflow diagram: Opportunity -> Active -> Completed).
export const STAGE_ORDER = ['new', 'inspected', 'proposal_delivered', 'approved', 'scheduled', 'active', 'completed', 'invoiced', 'paid'];

export const STAGE_LABELS = {
  new: 'New',
  inspected: 'Inspected',
  proposal_delivered: 'Estimate Delivered',
  approved: 'Approved',
  scheduled: 'Scheduled',
  active: 'Active',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Closed Lost',
};

export const PHASES = [
  { key: 'opportunity', label: 'Opportunity', stages: ['new', 'inspected', 'proposal_delivered', 'lost'] },
  { key: 'active_phase', label: 'Active Phase', stages: ['approved', 'scheduled', 'active', 'completed'] },
  { key: 'completed_phase', label: 'Completed Phase', stages: ['invoiced', 'paid'] },
];

export function phaseForStage(stage) {
  return PHASES.find(p => p.stages.includes(stage))?.key || 'opportunity';
}

// A project is an Opportunity (Estimate #) until it's Approved, then a
// Job (Job #). This is the one place that decision lives — every screen
// that displays a project's number should call this rather than reading
// job_number directly, so the two numbering systems can never drift.
export function isOpportunity(job) {
  return phaseForStage(job.stage) === 'opportunity';
}
export function projectNumber(job) {
  return isOpportunity(job) ? (job.estimate_number || '—') : (job.job_number || '—');
}
export function projectNumberLabel(job) {
  return isOpportunity(job) ? 'Estimate' : 'Job';
}
export function formattedProjectNumber(job) {
  return `${projectNumberLabel(job)} #${projectNumber(job)}`;
}

// Same idea as formattedProjectNumber, but as a leading fragment meant to
// sit in front of a project address ("Estimate #204 — 123 Main St") and
// blank out cleanly (no dangling "#—") when a job has no number yet.
// Callers must select job_number, estimate_number and stage on the job
// they pass in, or this always reads as an opportunity.
export function projectLabel(job) {
  if (!job) return '';
  const num = projectNumber(job);
  return num && num !== '—' ? `${projectNumberLabel(job)} #${num} — ` : '';
}

// Which documents are relevant to generate at each stage.
export const STAGE_DOCS = {
  new: ['proposal', 'contract'],
  inspected: ['proposal', 'contract'],
  proposal_delivered: ['proposal', 'contract'],
  approved: ['update'],
  scheduled: ['update'],
  active: ['update'],
  completed: ['update', 'invoice'],
  invoiced: ['invoice'],
  paid: ['invoice'],
};

export const JOB_COST_CATEGORIES = ['materials', 'labor', 'subcontractor', 'permits', 'equipment', 'other'];
export const JOB_COST_CATEGORY_LABELS = { materials: 'Materials', labor: 'Labor', subcontractor: 'Subcontractor', permits: 'Permits', equipment: 'Equipment', other: 'Other' };
export const RECEIPT_CATEGORIES = ['materials', 'equipment', 'permits', 'other'];
export const WORK_ORDER_STATUSES = ['draft', 'issued', 'accepted', 'declined', 'completed', 'invoiced', 'paid'];
export const WORK_ORDER_STATUS_LABELS = { draft: 'Draft', issued: 'Issued', accepted: 'Accepted', declined: 'Declined', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid' };

// Field progress — distinct from the business-lifecycle status above.
// Tracks whether the crew has physically started/finished the work,
// settable from the Sub Portal once a work order is accepted.
export const FIELD_PROGRESS_LABELS = { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed' };

// Options for the Calendar page's "New Event" form. Kept as a plain list
// (not a DB check constraint) so adding or renaming a type later is a
// one-line change here, not a migration.
export const EVENT_TYPE_LABELS = { meeting: 'Meeting', site_visit: 'Site Visit', inspection: 'Inspection', internal: 'Internal', other: 'Other' };

export const INTERNAL_UPDATE_CATEGORIES = [
  'Initial Inspection', 'Progress Update', 'Issue / Concern', 'Safety', 'Material Delivery', 'Inspection', 'Weather', 'Subcontractor', 'Completed', 'Other',
];

// Photos taken on an Internal Update auto-file into a folder named after
// the update's category (e.g. "Initial Inspection/2026-09-18") — one
// running folder per category, a dated subfolder per update occurrence.
// Only created when a photo actually exists; forward-only, no
// retroactive sorting of photos already on the job.
export function categoryPhotoFolder(category, dateLabel) {
  if (!category) return null;
  return `${category}/${dateLabel}`;
}

export const RFP_STATUS_LABELS = { open: 'Open', awarded: 'Awarded', not_awarded: 'Not Awarded' };
export const RFP_RECIPIENT_STATUS_LABELS = {
  sent: 'Sent', viewed: 'Viewed', responded: 'Responded', awarded: 'Awarded', not_awarded: 'Not Awarded',
};

export const CHANGE_ORDER_REASON_CATEGORIES = {
  'Scope & Condition Changes': [
    'Exposed Damage', 'Concealed/Latent Condition', 'Code Compliance Issue',
    'Design Discrepancy / RFI Resolution', 'Owner-Requested Change',
    'Material Substitution', 'Scope Addition', 'Scope Reduction / Deletion',
  ],
  'Schedule': [
    'Delay — Weather', 'Delay — Owner/Tenant', 'Delay — Permitting',
    'Delay — Material Lead Time', 'Delay — Subcontractor', 'Phase Completion',
    'Schedule Acceleration Request',
  ],
  'Site Conditions': [
    'Site Access Issue', 'Utility Conflict', 'Unforeseen Site Condition', 'Safety Incident/Hazard',
  ],
  'Financial / Administrative': [
    'Unit Price Adjustment', 'Allowance Overage', 'Permit Fee Change', 'Punch List Item',
  ],
  'Status / Informational': [
    'Progress Update', 'Inspection Result', 'Material Delivery',
    'Subcontractor Coordination', 'Customer Communication',
  ],
};

export const SERVICES_OFFERED = [
  'Framing', 'Roofing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Painting',
  'Flooring', 'Tile', 'Finish Carpentry', 'Cabinetry', 'Countertops', 'Concrete/Foundation', 'Masonry',
  'Windows & Doors', 'Insulation', 'Siding', 'Demo/Site Prep', 'Landscaping', 'General Labor', 'Other',
];

// Phase/schedule labels that aren't a billable trade — they don't belong
// on an estimate line item, but they're real things that show up on a
// job's schedule (a permit delay, a rough-in inspection, the final
// walkthrough, admin/paperwork time) and now have their own color in the
// trade palette above. Selectable on manual schedule phases (Schedule tab)
// alongside SERVICES_OFFERED, kept out of SERVICES_OFFERED itself so they
// never show up as an estimate line item trade.
export const SCHEDULE_PHASE_TYPES = ['Delay', 'Inspection', 'Punchlist', 'Walkthrough', 'Administrative'];

// Given the last-issued number in a sequence (e.g. "2026-014"), produces
// the next one ("2026-015"), preserving whatever prefix/padding pattern
// is already in use. Falls back to `fallback` (or a fresh 2026-001-style
// number) if there's no prior number to increment from.
//
// NOTE: kept only for compatibility — prefer nextInSeries() below.
// This version assumes whatever number you hand it is the *highest* one
// issued so far, which is only safe if you found it by actually scanning
// for the max. It is NOT safe to feed this "whichever row was created
// most recently," because job/estimate numbers are assigned at Approval
// time, not row-creation time — those two orderings frequently disagree.
export function nextSequentialNumber(lastNumber, fallback) {
  if (lastNumber) {
    const match = lastNumber.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, digits] = match;
      return prefix + (parseInt(digits, 10) + 1).toString().padStart(digits.length, '0');
    }
  }
  return fallback || `${new Date().getFullYear()}-001`;
}

// Computes the next number in a sequence from the FULL list of numbers
// already issued, rather than from a single "last" value. This is the
// safe replacement for nextSequentialNumber() wherever the "last" value
// was being picked by created_at ordering.
//
// Why this matters: job_number and estimate_number are assigned the
// moment a project reaches Approved (or is first created, for estimate
// numbers) — NOT in lockstep with when its row was created. A row created
// earlier can get approved later, and vice versa. So "the most recently
// created row" and "the row holding the highest number" are frequently
// different rows. Picking "last created" and incrementing it can hand out
// a number that's already taken, which is exactly what tripped the
// jobs_job_number_unique_idx constraint. Scanning every existing number
// and taking the true numeric max sidesteps the problem entirely — it
// doesn't care what order rows were created or approved in.
//
// Only numbers sharing the same non-digit prefix as `fallback` are
// considered, so a year rollover (e.g. fallback "2027-001") correctly
// starts a fresh count instead of continuing 2026's sequence.
export function nextInSeries(existingNumbers, fallback) {
  const fallbackMatch = (fallback || '').match(/^(.*?)(\d+)$/);
  const prefix = fallbackMatch ? fallbackMatch[1] : '';
  let digitLength = fallbackMatch ? fallbackMatch[2].length : 3;
  let maxValue = -1;

  for (const num of existingNumbers || []) {
    if (!num) continue;
    const match = num.match(/^(.*?)(\d+)$/);
    if (!match) continue;
    const [, numPrefix, digits] = match;
    if (numPrefix !== prefix) continue; // different series (e.g. a prior year) — ignore
    const value = parseInt(digits, 10);
    if (value > maxValue) {
      maxValue = value;
      digitLength = digits.length;
    }
  }

  if (maxValue === -1) return fallback || `${new Date().getFullYear()}-001`;
  return prefix + (maxValue + 1).toString().padStart(digitLength, '0');
}

export function formatPhone(value) {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function contractPathFor(job) {
  return job.project_type === 'commercial' ? `/jobs/${job.id}/contract` : `/jobs/${job.id}/residential-contract`;
}

export const STANDARD_ASSUMPTIONS_RESIDENTIAL = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Estimate valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (moisture, structural, electrical, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Homeowner is responsible for clearing the work area and relocating pets prior to each scheduled work day.',
  'Material selections not specified in the scope of work are estimated using a standard allowance and may affect final pricing.',
];

export const STANDARD_ASSUMPTIONS_COMMERCIAL = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Estimate valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (structural, mechanical, electrical, code-related, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Tenant improvement or buildout work requires landlord/property management approval prior to commencement, where applicable.',
  'Work is scheduled around building access hours and any tenant/property management coordination requirements.',
  'Pricing excludes furniture, fixtures, and equipment (FF&E) unless specifically listed in the scope of work.',
];

// Kept for backward compatibility with places that import the default list directly.
export const STANDARD_ASSUMPTIONS = STANDARD_ASSUMPTIONS_RESIDENTIAL;
