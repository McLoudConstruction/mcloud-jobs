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
};

export const PHASES = [
  { key: 'opportunity', label: 'Opportunity', stages: ['new', 'inspected', 'proposal_delivered'] },
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

export const SERVICES_OFFERED = [
  'Framing', 'Roofing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Painting',
  'Flooring', 'Tile', 'Cabinetry', 'Countertops', 'Concrete/Foundation', 'Masonry',
  'Windows & Doors', 'Insulation', 'Siding', 'Demo/Site Prep', 'Landscaping', 'General Labor', 'Other',
];

// Given the last-issued number in a sequence (e.g. "2026-014"), produces
// the next one ("2026-015"), preserving whatever prefix/padding pattern
// is already in use. Falls back to `fallback` (or a fresh 2026-001-style
// number) if there's no prior number to increment from.
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
