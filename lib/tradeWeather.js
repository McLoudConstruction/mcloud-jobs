// A starting guess only — every phase's Work Location is editable in the
// Schedule tab, and this never overrides an explicit choice. Trades not
// listed here (or a job with no default) fall back to 'indoor' as the
// more common case for a remodel-heavy trade mix.
export const DEFAULT_WORK_LOCATION_BY_TRADE = {
  'Framing': 'outdoor',
  'Roofing': 'outdoor',
  'Concrete/Foundation': 'outdoor',
  'Masonry': 'outdoor',
  'Windows & Doors': 'outdoor',
  'Siding': 'outdoor',
  'Demo/Site Prep': 'outdoor',
  'Landscaping': 'outdoor',
  'Electrical': 'indoor',
  'Plumbing': 'indoor',
  'HVAC': 'indoor',
  'Drywall': 'indoor',
  'Painting': 'indoor',
  'Flooring': 'indoor',
  'Tile': 'indoor',
  'Cabinetry': 'indoor',
  'Countertops': 'indoor',
  'Finish Carpentry': 'indoor',
  'Insulation': 'indoor',
  'General Labor': 'indoor',
  'Other': 'indoor',
};

export function defaultWorkLocationForPhase(phase, jobWorkLocation) {
  if (!phase.trade) return jobWorkLocation || 'indoor';
  return DEFAULT_WORK_LOCATION_BY_TRADE[phase.trade] || jobWorkLocation || 'indoor';
}
