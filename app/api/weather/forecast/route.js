import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { getForecastForCompany, getForecastForJob, WeatherConfigError } from '../../../../lib/integrations/weatherClient';

// Any signed-in staff member can view weather — same reasoning as the
// existing /api/weather route: it's not sensitive data, it just requires
// an owner to have saved an OpenWeatherMap API key first.
export async function GET(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  const force = url.searchParams.get('force') === '1';

  try {
    if (jobId) {
      const admin = getAdminClient();
      const { data: job, error } = await admin
        .from('jobs')
        .select('id, project_street, project_city, project_state, project_zip, site_lat, site_lng')
        .eq('id', jobId)
        .single();
      if (error || !job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

      const forecast = await getForecastForJob(job, force);
      if (!forecast) return NextResponse.json({ error: 'This job has no site address to look up weather for yet.' }, { status: 400 });
      return NextResponse.json(forecast);
    }

    const forecast = await getForecastForCompany(force);
    return NextResponse.json(forecast);
  } catch (err) {
    if (err instanceof WeatherConfigError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
