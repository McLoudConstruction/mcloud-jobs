// Every dashboard card that can be dragged into a custom order. This is
// deliberately separate from "new_opportunity_button" (a page action,
// not a positioned card) — that one stays a plain on/off toggle in
// Settings with no place in the drag order.
export const DASHBOARD_WIDGET_KEYS = [
  'weather_today',
  'weather_today_hourly',
  'weather_this_week',
  'sold_job_count',
  'total_ar',
  'total_paid',
  'revenue_ytd',
  'revenue_mtd',
  'total_profit',
  'sales_route_ai',
  'job_counts_by_stage',
  'overdue_opportunities',
];

export const DASHBOARD_WIDGET_LABELS = {
  weather_today: "Today's Weather",
  weather_today_hourly: "Today's Weather (Hourly)",
  weather_this_week: "This Week's Weather",
  sold_job_count: 'Sold Job Count Total',
  total_ar: 'Total AR Dollars',
  total_paid: 'Total Paid Dollars',
  revenue_ytd: 'Total Revenue YTD',
  revenue_mtd: 'Total Revenue MTD',
  total_profit: 'Total Profit Dollars',
  sales_route_ai: 'Create My Sales Route',
  job_counts_by_stage: 'Job Counts by Stage',
  overdue_opportunities: 'Overdue Opportunities',
};

// Merges a saved order with the canonical key list: known keys keep the
// saved order, and any key missing from a saved order (a widget added
// after the order was last saved, or a first-ever load with no saved
// order at all) is appended at the end rather than silently vanishing.
export function resolveWidgetOrder(savedOrder) {
  const saved = Array.isArray(savedOrder) ? savedOrder.filter(k => DASHBOARD_WIDGET_KEYS.includes(k)) : [];
  const missing = DASHBOARD_WIDGET_KEYS.filter(k => !saved.includes(k));
  return [...saved, ...missing];
}
