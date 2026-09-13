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
// window (One Call 3.0 only covers ~8 days out, so phases further out
// simply can't be checked yet — that's a "not yet knowable" state, not a
// clean bill of health, so callers should treat "no flag" for a far-out
// phase differently than "no flag" for a near-term one).
export function findPhaseWeatherFlag(phase, dailyForecast, rulesByTrade) {
  if (phase.work_location !== 'outdoor') return null;
  const rule = rulesByTrade[phase.trade];
  if (!rule) return null;

  const start = new Date(phase.start_date + 'T00:00:00').getTime();
  const end = new Date(phase.end_date + 'T00:00:00').getTime();

  for (const day of dailyForecast) {
    if (day.at < start || day.at > end) continue;
    const reasons = evaluateDayAgainstRule(day, rule);
    if (reasons.length > 0) {
      return { date: new Date(day.at).toISOString().slice(0, 10), reasons };
    }
  }
  return null;
}
