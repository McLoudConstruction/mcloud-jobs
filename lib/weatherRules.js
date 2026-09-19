// Compares one forecast day (from getForecast()'s `daily` array) against
// a trade's threshold row (from trade_weather_rules) and returns a list
// of plain-language reasons it's flagged, or an empty array if it's fine.
// Kept dependency-free and pure so it can be unit tested and reused from
// both the API route and, later, any client-side preview.
export function evaluateDayAgainstRule(day, rule) {
  if (!day || !rule) return [];
  const reasons = [];

  if (rule.min_temp_f != null && day.minF != null && day.minF < rule.min_temp_f) {
    reasons.push(`Low of ${day.minF}°F is below the ${rule.min_temp_f}°F minimum for this trade.`);
  }
  if (rule.max_temp_f != null && day.maxF != null && day.maxF > rule.max_temp_f) {
    reasons.push(`High of ${day.maxF}°F is above the ${rule.max_temp_f}°F maximum for this trade.`);
  }
  if (rule.max_wind_mph != null && day.windMph != null && day.windMph > rule.max_wind_mph) {
    reasons.push(`Wind of ${day.windMph} mph exceeds the ${rule.max_wind_mph} mph limit for this trade.`);
  }
  if (rule.blocks_on_rain && day.pop != null && day.pop >= 50 && ['Rain', 'Thunderstorm', 'Drizzle'].includes(day.condition)) {
    reasons.push(`${day.pop}% chance of ${day.condition.toLowerCase()} — this trade needs dry conditions.`);
  }
  if (rule.blocks_on_snow && day.condition === 'Snow') {
    reasons.push('Snow in the forecast — this trade needs to pause.');
  }

  return reasons;
}

// Given a phase (with trade, work_location, start_date, end_date) and the
// company/job's daily forecast array, returns { date, reasons } for the
// first at-risk day within both the phase's date range AND the forecast's
// window (One Call 4.0's timeline only covers ~8 days out, so phases
// further out simply can't be checked yet — that's a "not yet knowable"
// state, not a clean bill of health, so callers should treat "no flag"
// for a far-out phase differently than "no flag" for a near-term one).
//
// Deliberately compares calendar-date STRINGS ('YYYY-MM-DD'), not
// millisecond timestamps. This runs server-side, where Node has no
// reason to be in the job site's time zone — `new Date(phase.start_date
// + 'T00:00:00')` was being parsed as UTC midnight, while a forecast
// day's `.at` timestamp lands several hours *into* that UTC day, so the
// old `day.at > end` check excluded a phase's last day almost every
// time (and a single-day phase's only day, always). Plain date strings
// compare correctly with no time-zone math involved at all.
export function findPhaseWeatherFlag(phase, dailyForecast, rulesByTrade) {
  // 'mixed' phases have real outdoor exposure too (e.g. framing with some
  // indoor finish work bundled in), so they get weather-checked exactly
  // like 'outdoor' — only pure 'indoor' phases are skipped.
  if (phase.work_location !== 'outdoor' && phase.work_location !== 'mixed') return null;
  const rule = rulesByTrade[phase.trade];
  if (!rule) return null;

  for (const day of dailyForecast) {
    const dayDateStr = new Date(day.at).toISOString().slice(0, 10);
    if (dayDateStr < phase.start_date || dayDateStr > phase.end_date) continue;
    const reasons = evaluateDayAgainstRule(day, rule);
    if (reasons.length > 0) {
      return { date: dayDateStr, reasons };
    }
  }
  return null;
}
