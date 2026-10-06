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

export const REAL_ESTATE_AGENT_TYPE = 'Real Estate Agent';

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
  REAL_ESTATE_AGENT_TYPE,
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

// isOpportunity is still about workflow *phase* (Opportunity vs. Active
// vs. Completed) — used to show/hide tabs and icons appropriate to that
// phase. It no longer has anything to do with which number a project
// displays: every project has exactly one project_number, assigned once
// at creation, for its whole lifecycle, regardless of phase.
export function isOpportunity(job) {
  return phaseForStage(job.stage) === 'opportunity';
}
export function projectNumber(job) {
  return job?.project_number || '—';
}
export function formattedProjectNumber(job) {
  return `Project #${projectNumber(job)}`;
}

// Same idea as formattedProjectNumber, but as a leading fragment meant to
// sit in front of a project address ("Project #MC26014C — 123 Main St")
// and blank out cleanly (no dangling "#—") when a job has no number yet.
// Callers must select project_number on the job they pass in.
export function projectLabel(job) {
  if (!job) return '';
  const num = projectNumber(job);
  return num && num !== '—' ? `Project #${num} — ` : '';
}

// Subs know a customer by name, not by street — the sub portal names
// jobs "Lastname — Project #MC26014C" rather than leading with the
// address. Just the surname: takes the last whitespace-separated token
// of customer_name. customer_name is a company name on commercial jobs
// (no real "last name"), so this degrades to the full company name
// rather than mangling it.
export function customerLastName(job) {
  const name = (job?.customer_name || '').trim();
  if (!name) return '';
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

// The sub portal's job heading: "Smith — Project #MC26014C". Callers
// must select customer_name and project_number on the job they pass in.
export function subPortalJobHeading(job) {
  if (!job) return 'Job details unavailable';
  const last = customerLastName(job);
  const num = projectNumber(job);
  const numPart = num && num !== '—' ? `Project #${num}` : '';
  if (last && numPart) return `${last} — ${numPart}`;
  return last || numPart || 'Job details unavailable';
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

// Sub Portal's "Request Schedule Event" form — same types minus
// "Internal", which is office-only bookkeeping a sub has no reason to
// see or request.
export const SUB_EVENT_TYPE_LABELS = Object.fromEntries(
  Object.entries(EVENT_TYPE_LABELS).filter(([k]) => k !== 'internal')
);

// Event types a sub can request against ANY job they're visible on
// (bidding an RFP or already awarded) rather than only awarded work —
// asking to meet or walk a site is often exactly how a bid gets won in
// the first place, so gating it behind an award would be backwards.
// Anything else (Inspection, Other) still requires an awarded job, same
// as the phases/calendar bars.
export const SUB_UNRESTRICTED_EVENT_TYPES = ['meeting', 'site_visit'];

// Sub Portal calendar — a sub's requested date/time, pending staff
// approval before it becomes a real schedule_events row.
export const SCHEDULE_REQUEST_STATUS_LABELS = { pending: 'Pending', approved: 'Approved', declined: 'Declined' };

export const INTERNAL_UPDATE_CATEGORIES = [
  'Initial Inspection', 'Progress Update', 'Issue / Concern', 'Safety', 'Material Delivery', 'Inspection', 'Weather', 'Subcontractor', 'Punch List', 'Completed', 'Other',
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

// Customer-facing name for time on the schedule with no crew on site but
// real work still happening behind the scenes (permitting, material
// ordering, sub coordination, inspections scheduling). Deliberately not
// "Delay" or "Administrative" — a customer reading their schedule should
// see a reason work is justified, not a gap. Its own constant (rather
// than just a literal in SCHEDULE_PHASE_TYPES below) because it's also
// the one phase type that bumps the rest of the schedule when added —
// see insertPhaseChronologically() in lib/scheduleDates.js.
export const PROJECT_COORDINATION_TYPE = 'Project Coordination';

// Phase/schedule labels that aren't a billable trade — they don't belong
// on an estimate line item, but they're real things that show up on a
// job's schedule (a permit delay, a rough-in inspection, the final
// walkthrough, project coordination time) and now have their own color in
// the trade palette above. Selectable on manual schedule phases (Schedule
// tab) alongside SERVICES_OFFERED, kept out of SERVICES_OFFERED itself so
// they never show up as an estimate line item trade.
export const SCHEDULE_PHASE_TYPES = ['Delay', 'Inspection', 'Punchlist', 'Walkthrough', PROJECT_COORDINATION_TYPE];

// Project Number format: MC{YY}{NNN}{C|R} — e.g. MC26014C (Commercial),
// MC26014R (Residential). NNN is ONE shared counter per calendar year
// across both project types — a Commercial and a Residential job
// created back to back get consecutive numbers, just with different
// trailing letters. Assigned exactly once, at creation
// (assignNextProjectNumber in assignProjectNumber.js), and never
// reassigned for the life of the project.
const PROJECT_NUMBER_RE = /^MC(\d{2})(\d+)[CR]$/;

// Computes the next project number for `projectType` in the current
// year from the FULL list of project numbers already issued, rather
// than from "whichever row was created most recently" — creation order
// and assignment order aren't guaranteed to match if two jobs are being
// entered around the same time, so scanning every existing number for
// the true numeric max (within this year) sidesteps handing out a
// number that's already taken.
export function nextProjectNumber(existingNumbers, projectType, now) {
  const year = (now || new Date()).getFullYear();
  const yy = String(year).slice(-2);
  const letter = projectType === 'commercial' ? 'C' : 'R';

  let maxValue = 0;
  for (const num of existingNumbers || []) {
    const match = (num || '').match(PROJECT_NUMBER_RE);
    if (!match) continue;
    if (match[1] !== yy) continue; // a different year's sequence — ignore
    const value = parseInt(match[2], 10);
    if (value > maxValue) maxValue = value;
  }

  return `MC${yy}${(maxValue + 1).toString().padStart(3, '0')}${letter}`;
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
