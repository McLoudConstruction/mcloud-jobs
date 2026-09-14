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
// Geocodes a US address via OpenWeatherMap's Geocoding API — same API
// key as everything else here, no separate subscription. Deliberately
// geocodes at the CITY level (or zip), not the street address: a street
// number adds precision this app has no use for (forecasts aren't
// block-level granular), and OpenWeatherMap's Geocoding API is built for
// city-level lookups — a full street address reliably comes back with
// zero results, which used to surface as a misleading "no address on
// file" even when the job's address was complete and correct. Cached
// indefinitely by normalized city/state/zip — a city doesn't move, and
// this also means every job in the same city shares one cache entry
// instead of each one paying for its own geocode call.
export async function geocodeAddress({ street, city, state, zip }) {
  const admin = getAdminClient();
  const key = normalizeAddressKey({ city, state, zip });
  if (!key.replace(/\|/g, '')) return null;

  const { data: cached } = await admin.from('geocode_cache').select('lat, lng, name').eq('address_key', key).single();
  if (cached) return { lat: cached.lat, lng: cached.lng, name: cached.name };

  const apiKey = await getApiKey();
  let url;
  if (zip) {
    url = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zip)},US&appid=${apiKey}`;
  } else if (city) {
    const q = [city, state, 'US'].filter(Boolean).join(',');
    url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${apiKey}`;
  } else {
    return null;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: ${await res.text()}`);
  const data = await res.json();
  const point = Array.isArray(data) ? data[0] : data;
  if (!point || (point.lat === undefined && point.lat !== 0)) return null;

  const lat = point.lat, lng = point.lon;
  // A human-readable label ("Raytown, MO") for display — the zip lookup
  // only ever returns a bare city name (no state), so fall back to the
  // state that was actually passed in rather than showing an
  // incomplete label.
  const name = point.state ? `${point.name}, ${point.state}` : (point.name && state ? `${point.name}, ${state}` : point.name);
  await admin.from('geocode_cache').upsert({ address_key: key, lat, lng, name, fetched_at: new Date().toISOString() });
  return { lat, lng, name };
}

// Fetches hourly (48hr) + daily (8-day) forecast for a point ("current"
// is derived from the first hourly record — see note below), sharing one
// cached payload across any lookup that rounds to the same ~5.5km grid
// cell within the TTL window. Pass force:true to bypass a cached row
// entirely — mainly useful right after a code change to this file, since
// otherwise a stale cached payload keeps being served for up to
// FORECAST_TTL_MINUTES regardless of what the code now does.
export async function getForecast(lat, lng, { force = false } = {}) {
  const admin = getAdminClient();
  const gridLat = roundToGrid(lat);
  const gridLng = roundToGrid(lng);

  if (!force) {
    const { data: cached } = await admin.from('weather_cache').select('payload, fetched_at').eq('grid_lat', gridLat).eq('grid_lng', gridLng).single();
    // Not just a TTL check — a cached row written by an older, broken
    // version of this function (e.g. the since-fixed /current parsing)
    // would otherwise keep serving bad data for the full TTL window with
    // no way to self-correct short of someone remembering to pass
    // force=1. Treating a payload with no usable current temp as a miss
    // means a code fix here takes effect on the next request, period.
    const usable = cached?.payload?.current?.tempF != null;
    if (cached && usable && (Date.now() - new Date(cached.fetched_at).getTime()) < FORECAST_TTL_MINUTES * 60 * 1000) {
      return cached.payload;
    }
  }

  const apiKey = await getApiKey();
  const nowSec = Math.floor(Date.now() / 1000);

  // OpenWeather retired the single combined /data/3.0/onecall response —
  // as of 4.0 it's a modular API with a separate /timeline/{resolution}
  // endpoint per granularity. There's also a dedicated /current endpoint,
  // but its response shape wasn't reliably confirmable from public docs
  // and returned fields we couldn't parse in practice — rather than keep
  // guessing at its shape, "current" is derived from the first hourly
  // timeline record instead, which is confirmed working. That also drops
  // this to two calls instead of three per cache miss.
  const [hourlyRes, dailyRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/4.0/onecall/timeline/1h?lat=${lat}&lon=${lng}&cnt=48&start=${nowSec}&units=imperial&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/4.0/onecall/timeline/1day?lat=${lat}&lon=${lng}&cnt=8&start=${nowSec}&units=imperial&appid=${apiKey}`),
  ]);
  for (const res of [hourlyRes, dailyRes]) {
    if (!res.ok) throw new Error(`Forecast lookup failed: ${await res.text()}`);
  }
  const [hourlyRaw, dailyRaw] = await Promise.all([hourlyRes.json(), dailyRes.json()]);

  const hourlyRecords = hourlyRaw.data || hourlyRaw.hourly || [];
  const dailyRecords = dailyRaw.data || dailyRaw.daily || [];
  const nowRecord = hourlyRecords[0];

  const payload = {
    location: { lat, lng },
    current: nowRecord && {
      tempF: nowRecord.temp != null ? Math.round(nowRecord.temp) : null,
      feelsLikeF: nowRecord.feels_like != null ? Math.round(nowRecord.feels_like) : null,
      windMph: nowRecord.wind_speed != null ? Math.round(nowRecord.wind_speed) : null,
      condition: nowRecord.weather?.[0]?.main,
      description: nowRecord.weather?.[0]?.description,
      icon: nowRecord.weather?.[0]?.icon,
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
export async function getForecastForJob(job, force = false) {
  const admin = getAdminClient();
  let lat = job.site_lat, lng = job.site_lng;
  let locationName = null;
  if (lat == null || lng == null) {
    const point = await geocodeAddress({ street: job.project_street, city: job.project_city, state: job.project_state, zip: job.project_zip });
    if (!point) return null;
    lat = point.lat; lng = point.lng; locationName = point.name;
    await admin.from('jobs').update({ site_lat: lat, site_lng: lng, site_geocoded_at: new Date().toISOString() }).eq('id', job.id);
  }
  const forecast = await getForecast(lat, lng, { force });
  return { ...forecast, locationName: locationName || null };
}

// Looks up the company-wide default location (the zip already configured
// in Settings → Integrations → Weather) for the dashboard widgets.
export async function getForecastForCompany(force = false) {
  const admin = getAdminClient();
  const { data: cred } = await admin.from('integration_credentials').select('config').eq('provider', 'weather').single();
  const zip = cred?.config?.zip;
  if (!zip) throw new WeatherConfigError('No default zip code set — add one in Settings → Integrations → Weather.');
  const point = await geocodeAddress({ zip });
  if (!point) throw new Error(`Could not geocode zip code ${zip}.`);
  const forecast = await getForecast(point.lat, point.lng, { force });
  return { ...forecast, locationName: point.name || null };
}
