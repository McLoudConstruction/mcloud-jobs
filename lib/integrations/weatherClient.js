import { getAdminClient } from '../supabaseAdmin';
import { decrypt } from './crypto';

// This is intentionally a PLATFORM-level integration, not a per-tenant
// one like Resend/QuickBooks: weather is the same data for every business
// asking about the same place, so one OpenWeatherMap "One Call by Call"
// subscription (still free at normal volume) backs every lookup, and
// weather_cache below is what keeps call volume flat as usage grows —
// it's keyed by rounded location, not by job or company, so ten jobs in
// the same metro share one cached forecast instead of paying for ten
// calls. If this app is ever split into a true multi-tenant product,
// this file doesn't need to change — only the tables that don't yet have
// a tenant_id would.

const FORECAST_TTL_MINUTES = 30;
const GEOCODE_GRID = 0.05; // ~5.5km — cache key precision for weather_cache, not stored precision for jobs

async function getApiKey() {
  const admin = getAdminClient();
  const { data: cred } = await admin.from('integration_credentials').select('api_key_enc').eq('provider', 'weather').single();
  if (!cred) throw new WeatherConfigError('Weather is not configured yet — add an OpenWeatherMap API key in Settings → Integrations.');
  return decrypt(cred.api_key_enc);
}

export class WeatherConfigError extends Error {}

function roundToGrid(value) {
  return Math.round(value / GEOCODE_GRID) * GEOCODE_GRID;
}

function normalizeAddressKey({ street, city, state, zip }) {
  return [street, city, state, zip].map(v => (v || '').trim().toLowerCase()).join('|');
}

// Geocodes a US address (or bare zip) via OpenWeatherMap's Geocoding API
// — same API key as everything else here, no separate subscription.
// Cached indefinitely by normalized address: a street address doesn't
// move, so there's no TTL to expire this on.
export async function geocodeAddress({ street, city, state, zip }) {
  const admin = getAdminClient();
  const key = normalizeAddressKey({ street, city, state, zip });
  if (!key.replace(/\|/g, '')) return null;

  const { data: cached } = await admin.from('geocode_cache').select('lat, lng').eq('address_key', key).single();
  if (cached) return { lat: cached.lat, lng: cached.lng };

  const apiKey = await getApiKey();
  let url;
  if (street && city) {
    const q = [street, city, state].filter(Boolean).join(',');
    url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${apiKey}`;
  } else if (zip) {
    url = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zip)},US&appid=${apiKey}`;
  } else {
    return null;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: ${await res.text()}`);
  const data = await res.json();
  const point = Array.isArray(data) ? data[0] : data;
  if (!point || (point.lat === undefined && point.lat !== 0)) return null;

  const lat = point.lat, lng = point.lon;
  await admin.from('geocode_cache').upsert({ address_key: key, lat, lng, fetched_at: new Date().toISOString() });
  return { lat, lng };
}

// Fetches current + hourly (48hr) + daily (8-day) forecast for a point,
// via One Call 3.0, sharing one cached payload across any lookup that
// rounds to the same ~5.5km grid cell within the TTL window.
export async function getForecast(lat, lng) {
  const admin = getAdminClient();
  const gridLat = roundToGrid(lat);
  const gridLng = roundToGrid(lng);

  const { data: cached } = await admin.from('weather_cache').select('payload, fetched_at').eq('grid_lat', gridLat).eq('grid_lng', gridLng).single();
  if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) < FORECAST_TTL_MINUTES * 60 * 1000) {
    return cached.payload;
  }

  const apiKey = await getApiKey();
  const nowSec = Math.floor(Date.now() / 1000);

  // OpenWeather retired the single combined /data/3.0/onecall response —
  // as of 4.0 it's a modular API: a dedicated /current endpoint plus a
  // separate /timeline/{resolution} endpoint per granularity. Three calls
  // instead of one, but weather_cache above means this still only happens
  // once per ~5.5km grid cell per TTL window, not once per request.
  const [currentRes, hourlyRes, dailyRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/4.0/onecall/current?lat=${lat}&lon=${lng}&units=imperial&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/4.0/onecall/timeline/1h?lat=${lat}&lon=${lng}&cnt=48&start=${nowSec}&units=imperial&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/4.0/onecall/timeline/1day?lat=${lat}&lon=${lng}&cnt=8&start=${nowSec}&units=imperial&appid=${apiKey}`),
  ]);
  for (const res of [currentRes, hourlyRes, dailyRes]) {
    if (!res.ok) throw new Error(`Forecast lookup failed: ${await res.text()}`);
  }
  const [currentRaw, hourlyRaw, dailyRaw] = await Promise.all([currentRes.json(), hourlyRes.json(), dailyRes.json()]);

  // Defensive against either nesting — public docs for 4.0's /current
  // endpoint weren't fully confirmable at the time this was written, so
  // this handles both "fields at the top level" and "fields under a
  // `current` key" without guessing wrong and silently showing nulls.
  const c = currentRaw.current || currentRaw;
  const hourlyRecords = hourlyRaw.data || hourlyRaw.hourly || [];
  const dailyRecords = dailyRaw.data || dailyRaw.daily || [];

  const payload = {
    location: { lat, lng },
    current: {
      tempF: c.temp != null ? Math.round(c.temp) : null,
      feelsLikeF: c.feels_like != null ? Math.round(c.feels_like) : null,
      windMph: c.wind_speed != null ? Math.round(c.wind_speed) : null,
      condition: c.weather?.[0]?.main,
      description: c.weather?.[0]?.description,
      icon: c.weather?.[0]?.icon,
    },
    hourly: hourlyRecords.slice(0, 48).map(h => ({
      at: h.dt * 1000,
      tempF: Math.round(h.temp),
      pop: Math.round((h.pop || 0) * 100),
      condition: h.weather?.[0]?.main,
      icon: h.weather?.[0]?.icon,
    })),
    daily: dailyRecords.slice(0, 8).map(d => ({
      at: d.dt * 1000,
      minF: Math.round(d.temp?.min),
      maxF: Math.round(d.temp?.max),
      pop: Math.round((d.pop || 0) * 100),
      windMph: Math.round(d.wind_speed),
      condition: d.weather?.[0]?.main,
      icon: d.weather?.[0]?.icon,
    })),
  };

  await admin.from('weather_cache').upsert({ grid_lat: gridLat, grid_lng: gridLng, payload, fetched_at: new Date().toISOString() });
  return payload;
}

// Looks up a job's forecast, geocoding and persisting its site address
// on first use if it hasn't been geocoded yet.
export async function getForecastForJob(job) {
  const admin = getAdminClient();
  let lat = job.site_lat, lng = job.site_lng;
  if (lat == null || lng == null) {
    const point = await geocodeAddress({ street: job.project_street, city: job.project_city, state: job.project_state, zip: job.project_zip });
    if (!point) return null;
    lat = point.lat; lng = point.lng;
    await admin.from('jobs').update({ site_lat: lat, site_lng: lng, site_geocoded_at: new Date().toISOString() }).eq('id', job.id);
  }
  return getForecast(lat, lng);
}

// Looks up the company-wide default location (the zip already configured
// in Settings → Integrations → Weather) for the dashboard widgets.
export async function getForecastForCompany() {
  const admin = getAdminClient();
  const { data: cred } = await admin.from('integration_credentials').select('config').eq('provider', 'weather').single();
  const zip = cred?.config?.zip;
  if (!zip) throw new WeatherConfigError('No default zip code set — add one in Settings → Integrations → Weather.');
  const point = await geocodeAddress({ zip });
  if (!point) throw new Error(`Could not geocode zip code ${zip}.`);
  return getForecast(point.lat, point.lng);
}
