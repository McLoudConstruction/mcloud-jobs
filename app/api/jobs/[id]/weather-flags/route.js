import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';
import { getForecastForJob, WeatherConfigError } from '../../../../../lib/integrations/weatherClient';
import { findPhaseWeatherFlag } from '../../../../../lib/weatherRules';

export async function GET(request, { params }) {
  const jobId = params.id;
  const admin = getAdminClient();

  try {
    const [jobRes, phasesRes, rulesRes] = await Promise.all([
      admin.from('jobs').select('id, project_street, project_city, project_state, project_zip, site_lat, site_lng').eq('id', jobId).single(),
      admin.from('job_phases').select('id, trade, work_location, start_date, end_date').eq('job_id', jobId).eq('status', 'published'),
      admin.from('trade_weather_rules').select('*'),
    ]);
    if (jobRes.error || !jobRes.data) return NextResponse.json({ error: 'Job not found.', detail: jobRes.error?.message }, { status: 404 });
    // Surfaced explicitly rather than silently treated as "no rows" —
    // an RLS/permissions or schema issue on either table would otherwise
    // look identical to "this job just has no outdoor phases," which is
    // exactly the ambiguity that made this bug hard to pin down.
    if (phasesRes.error) return NextResponse.json({ error: `Could not load job_phases: ${phasesRes.error.message}` }, { status: 500 });
    if (rulesRes.error) return NextResponse.json({ error: `Could not load trade_weather_rules: ${rulesRes.error.message}` }, { status: 500 });

    const job = jobRes.data;
    const phases = phasesRes.data || [];
    const rules = rulesRes.data || [];

    // 'mixed' phases carry real outdoor exposure too, so they're checked
    // alongside 'outdoor' ones — only pure 'indoor' phases are excluded.
    const outdoorPhases = phases.filter(p => (p.work_location === 'outdoor' || p.work_location === 'mixed') && p.trade);
    if (outdoorPhases.length === 0) {
      // Debug field is temporary — shows exactly what this query saw for
      // this job's phases, since "no outdoor phases" and "the query
      // didn't see what Supabase's Table Editor shows you" need to be
      // told apart. Safe to remove once this is confirmed working.
      return NextResponse.json({
        flags: {},
        checkedThrough: null,
        debug: {
          totalPhasesFound: phases.length,
          phases: phases.map(p => ({ id: p.id, trade: p.trade, work_location: p.work_location })),
        },
      });
    }

    const forecast = await getForecastForJob(job);
    if (!forecast) {
      return NextResponse.json({
        flags: {},
        checkedThrough: null,
        note: 'No site address on file to check weather against yet.',
        // Temporary — shows exactly what address data (if any) this job
        // had to work with, so "no address entered" and "address present
        // but geocoding failed" don't look identical from the outside.
        debug: {
          project_street: job.project_street,
          project_city: job.project_city,
          project_state: job.project_state,
          project_zip: job.project_zip,
        },
      });
    }

    const rulesByTrade = Object.fromEntries(rules.map(r => [r.trade, r]));
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
