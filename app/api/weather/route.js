import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../lib/supabaseAdmin';
import { decrypt } from '../../../lib/integrations/crypto';

// Any signed-in staff member can view weather — it's not sensitive data,
// same as the other dashboard widgets. Requires an owner to have saved
// an OpenWeatherMap API key in Settings → Integrations first.
export async function GET(request) {
  const url = new URL(request.url);
  const zip = url.searchParams.get('zip');
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');

  const admin = getAdminClient();
  const { data: cred } = await admin.from('integration_credentials').select('api_key_enc, config').eq('provider', 'weather').single();
  if (!cred) return NextResponse.json({ error: 'Weather is not configured yet — add an API key in Settings → Integrations.' }, { status: 400 });

  const apiKey = decrypt(cred.api_key_enc);
  const query = zip
    ? `zip=${encodeURIComponent(zip)},us`
    : lat && lon
    ? `lat=${lat}&lon=${lon}`
    : cred.config?.zip
    ? `zip=${encodeURIComponent(cred.config.zip)},us`
    : null;
  if (!query) return NextResponse.json({ error: 'No location set — add a zip code in Settings → Integrations, or pass ?zip= / ?lat=&lon=.' }, { status: 400 });

  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${query}&units=imperial&appid=${apiKey}`);
  if (!res.ok) return NextResponse.json({ error: `Weather lookup failed: ${await res.text()}` }, { status: 502 });
  const data = await res.json();

  return NextResponse.json({
    location: data.name,
    tempF: Math.round(data.main?.temp),
    feelsLikeF: Math.round(data.main?.feels_like),
    condition: data.weather?.[0]?.main,
    description: data.weather?.[0]?.description,
    windMph: data.wind?.speed,
    icon: data.weather?.[0]?.icon,
  });
}
