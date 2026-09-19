import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { getForecastForJob, WeatherConfigError } from '../../../../lib/integrations/weatherClient';
import { findPhaseWeatherFlag } from '../../../../lib/weatherRules';

// Same "not yet knowable beyond ~8 days" limitation as the per-job
// weather-flags route — see that route's comments for why.
export async function GET() {
  const admin = getAdminClient();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [{ data: rules }, { data: phases }] = await Promise.all([
      admin.from('trade_weather_rules').select('*'),
      admin
        .from('job_phases')
        .select('id, label, trade, work_location, start_date, end_date, job_id, jobs(id, job_number, customer_name, stage, project_street, project_city, project_state, project_zip, site_lat, site_lng)')
        .eq('status', 'published')
        .in('work_location', ['outdoor', 'mixed'])
        .not('trade', 'is', null)
        .lte('start_date', weekOut)
        .gte('end_date', today),
    ]);

    const rulesByTrade = Object.fromEntries((rules || []).map(r => [r.trade, r]));
    // A job marked lost obviously isn't getting worked regardless of what
    // phases it has on file; everything else (including completed/
    // invoiced, since the physical work may still be finishing up) stays
    // in scope.
    const activePhases = (phases || []).filter(p => p.jobs && p.jobs.stage !== 'lost');

    const flagged = [];
    // Sequential rather than Promise.all on purpose — most phases share a
    // job (or nearby jobs share a forecast grid cell), so this lets
    // weatherClient's cache absorb repeat lookups instead of firing a
    // burst of identical outbound calls at once.
    for (const phase of activePhases) {
      let forecast;
      try {
        forecast = await getForecastForJob(phase.jobs);
      } catch {
        continue; // one job's geocode/forecast failure shouldn't sink the whole widget
      }
      if (!forecast) continue;
      const flag = findPhaseWeatherFlag(phase, forecast.daily, rulesByTrade);
      if (flag) {
        flagged.push({
          jobId: phase.jobs.id,
          jobNumber: phase.jobs.job_number,
          customerName: phase.jobs.customer_name,
          phaseId: phase.id,
          phaseLabel: phase.label,
          trade: phase.trade,
          startDate: phase.start_date,
          endDate: phase.end_date,
          date: flag.date,
          reasons: flag.reasons,
        });
      }
    }

    flagged.sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({ flaggedCount: flagged.length, flagged });
  } catch (err) {
    if (err instanceof WeatherConfigError) return NextResponse.json({ flaggedCount: 0, flagged: [] });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
