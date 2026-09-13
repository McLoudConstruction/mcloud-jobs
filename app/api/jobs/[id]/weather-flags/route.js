import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';
import { getForecastForJob, WeatherConfigError } from '../../../../../lib/integrations/weatherClient';
import { findPhaseWeatherFlag } from '../../../../../lib/weatherRules';

export async function GET(request, { params }) {
  const jobId = params.id;
  const admin = getAdminClient();

  try {
    const [{ data: job, error: jobErr }, { data: phases }, { data: rules }] = await Promise.all([
      admin.from('jobs').select('id, project_street, project_city, project_state, project_zip, site_lat, site_lng').eq('id', jobId).single(),
      admin.from('job_phases').select('id, trade, work_location, start_date, end_date').eq('job_id', jobId),
      admin.from('trade_weather_rules').select('*'),
    ]);
    if (jobErr || !job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const outdoorPhases = (phases || []).filter(p => p.work_location === 'outdoor' && p.trade);
    if (outdoorPhases.length === 0) return NextResponse.json({ flags: {}, checkedThrough: null });

    const forecast = await getForecastForJob(job);
    if (!forecast) return NextResponse.json({ flags: {}, checkedThrough: null, note: 'No site address on file to check weather against yet.' });

    const rulesByTrade = Object.fromEntries((rules || []).map(r => [r.trade, r]));
    const flags = {};
    const noRulePhaseIds = [];
    for (const phase of outdoorPhases) {
      if (!rulesByTrade[phase.trade]) { noRulePhaseIds.push(phase.id); continue; }
      const flag = findPhaseWeatherFlag(phase, forecast.daily, rulesByTrade);
      if (flag) flags[phase.id] = flag;
    }

    const checkedThrough = forecast.daily.length > 0 ? new Date(forecast.daily[forecast.daily.length - 1].at).toISOString().slice(0, 10) : null;
    return NextResponse.json({ flags, noRulePhaseIds, checkedThrough });
  } catch (err) {
    if (err instanceof WeatherConfigError) return NextResponse.json({ flags: {}, checkedThrough: null }); // silently skip if weather isn't configured yet
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
