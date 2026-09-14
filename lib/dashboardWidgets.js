// Fixed layout for the dashboard — purpose-built cards, not draggable
// generic widgets. Order lives in code (DASHBOARD_ORDER), not in a
// per-account setting; Settings → Dashboard only controls which of
// these show at all, via the same enable/disable toggles as before.
export const DASHBOARD_ORDER = [
  'weather',
  'cash',
  'pipeline_backlog',
  'profitability',
  'schedule_health',
  'total_profit',
  'sales_route_ai',
  'job_counts_by_stage',
  'overdue_opportunities',
];

export const DASHBOARD_WIDGET_LABELS = {
  weather: 'Weather (Today / Hourly / Week)',
  cash: 'Cash (Net Cash, AR, AP, Total Paid)',
  pipeline_backlog: 'Pipeline & Backlog',
  profitability: 'Profitability (Income, Margin)',
  schedule_health: 'Schedule Health (Starting This Week, Weather Risk)',
  total_profit: 'Total Profit Dollars',
  sales_route_ai: 'Create My Sales Route',
  job_counts_by_stage: 'Job Counts by Stage',
  overdue_opportunities: 'Overdue Opportunities',
};
