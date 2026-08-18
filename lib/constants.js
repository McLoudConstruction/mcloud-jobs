export const PROPERTY_TYPES = [
  'Multi-Family',
  'Commercial - Office',
  'Commercial - Retail',
  'Commercial - Industrial',
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
  proposal_delivered: 'Proposal Delivered',
  approved: 'Approved',
  scheduled: 'Scheduled',
  active: 'Active',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

export const PHASES = [
  { key: 'opportunity', label: 'Opportunity Phase', stages: ['new', 'inspected', 'proposal_delivered'] },
  { key: 'active_phase', label: 'Active Phase', stages: ['approved', 'scheduled', 'active', 'completed'] },
  { key: 'completed_phase', label: 'Completed Phase', stages: ['invoiced', 'paid'] },
];

export function phaseForStage(stage) {
  return PHASES.find(p => p.stages.includes(stage))?.key || 'opportunity';
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

export function contractPathFor(job) {
  return job.project_type === 'commercial' ? `/jobs/${job.id}/contract` : `/jobs/${job.id}/residential-contract`;
}

export const STANDARD_ASSUMPTIONS_RESIDENTIAL = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Proposal valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (moisture, structural, electrical, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Homeowner is responsible for clearing the work area and relocating pets prior to each scheduled work day.',
  'Material selections not specified in the scope of work are estimated using a standard allowance and may affect final pricing.',
];

export const STANDARD_ASSUMPTIONS_COMMERCIAL = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Proposal valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (structural, mechanical, electrical, code-related, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Tenant improvement or buildout work requires landlord/property management approval prior to commencement, where applicable.',
  'Work is scheduled around building access hours and any tenant/property management coordination requirements.',
  'Pricing excludes furniture, fixtures, and equipment (FF&E) unless specifically listed in the scope of work.',
];

// Kept for backward compatibility with places that import the default list directly.
export const STANDARD_ASSUMPTIONS = STANDARD_ASSUMPTIONS_RESIDENTIAL;
