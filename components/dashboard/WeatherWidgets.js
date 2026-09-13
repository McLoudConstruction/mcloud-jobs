'use client';
import { useEffect, useState } from 'react';
import ScrollerWithArrows from './ScrollerWithArrows';

// Shared by all three widgets so the dashboard makes one forecast
// request, not three — the underlying API call is already cached
// server-side (weatherClient.js), but there's no reason to make three
// round trips from the browser for data that's identical across widgets.
export function useCompanyForecast() {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/weather/forecast')
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        if (data.error) setError(data.error);
        else setForecast(data);
      })
      .catch(err => mounted && setError(err.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  return { forecast, error, loading };
}

function dayLabel(ms, index) {
  if (index === 0) return 'Today';
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short' });
}

function hourLabel(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toUpperCase();
}

function ConditionIcon({ icon, alt, size = 36 }) {
  if (!icon) return null;
  return <img src={`https://openweathermap.org/img/wn/${icon}@2x.png`} alt={alt || ''} width={size} height={size} style={{ display: 'block', margin: '0 auto' }} />;
}

function WeatherEmptyState({ loading, error }) {
  if (loading) return <div className="empty-state">Loading weather…</div>;
  if (error) return <div className="empty-state">{error}</div>;
  return null;
}

export function WeatherTodayWidget({ forecast, loading, error }) {
  const c = forecast?.current;
  return (
    <div className="card">
      <h3>Today&apos;s Weather</h3>
      {!c ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConditionIcon icon={c.icon} alt={c.description} size={40} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--heading)', lineHeight: 1 }}>{c.tempF}°F</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'capitalize' }}>{c.description}</div>
            <div style={{ fontSize: 9.5, color: 'var(--ink-soft)' }}>Feels {c.feelsLikeF}°F · Wind {c.windMph} mph</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Spans two grid columns and one row — a wide, short strip rather than a
// tall one, since a card that just needs to show a row of hours doesn't
// need much vertical room.
export function WeatherHourlyWidget({ forecast, loading, error }) {
  const hours = (forecast?.hourly || []).slice(0, 24);
  return (
    <div className="card" style={{ gridColumn: 'span 2', gridRow: 'span 2', display: 'flex', flexDirection: 'column' }}>
      <h3>Today&apos;s Weather — Hourly</h3>
      {hours.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
          <ScrollerWithArrows ariaLabel="hours">
            {hours.map((h, i) => (
              <div
                key={i}
                style={{
                  flexShrink: 0, width: 74, textAlign: 'center', padding: '4px 4px',
                  borderRight: i < hours.length - 1 ? '1px solid var(--line)' : 'none',
                  scrollSnapAlign: 'start',
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginBottom: 4 }}>{hourLabel(h.at)}</div>
                <ConditionIcon icon={h.icon} alt={h.condition} size={30} />
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--heading)', marginTop: 2 }}>{h.tempF}°</div>
                <div style={{ fontSize: 9.5, color: '#4a90c4', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  💧 {h.pop}%
                </div>
              </div>
            ))}
          </ScrollerWithArrows>
        </div>
      )}
    </div>
  );
}

// Rough day-part buckets, checked against the browser's local time zone
// (no server-side timezone data needed — this renders client-side, and
// staff and jobs are assumed to be in the same time zone).
const DAY_PARTS = [
  { abbr: 'Ovn', label: 'Overnight', startHour: 0, endHour: 5 },
  { abbr: 'AM', label: 'Morning', startHour: 6, endHour: 11 },
  { abbr: 'PM', label: 'Afternoon', startHour: 12, endHour: 17 },
  { abbr: 'Eve', label: 'Evening', startHour: 18, endHour: 23 },
];
const RAIN_THRESHOLD_PCT = 30;

function isSameLocalDay(ms, otherMs) {
  const a = new Date(ms), b = new Date(otherMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// The hourly timeline only covers ~48 hours out (an OpenWeatherMap
// limit, not something this app controls), so this can only say *when*
// rain is coming for today and tomorrow — returns null for days beyond
// that, which the caller falls back to the plain daily percentage for.
// Returns just the EARLIEST at-risk block rather than every flagged
// block — "rain starts this afternoon" is what actually matters for
// deciding whether a crew is safe outdoors in the morning, and a
// narrow day-column doesn't have room to list every block anyway.
function earliestRainWindow(dayAt, hourly) {
  const hoursForDay = hourly.filter(h => isSameLocalDay(h.at, dayAt));
  if (hoursForDay.length === 0) return null;

  for (const part of DAY_PARTS) {
    const maxPop = hoursForDay.reduce((max, h) => {
      const hour = new Date(h.at).getHours();
      return (hour >= part.startHour && hour <= part.endHour) ? Math.max(max, h.pop) : max;
    }, 0);
    if (maxPop >= RAIN_THRESHOLD_PCT) return { hasRain: true, abbr: part.abbr, pop: maxPop };
  }
  return { hasRain: false };
}

// Rebuilt horizontal (matching the Hourly widget's pattern) instead of
// stacked vertical day rows — same footprint as Hourly (2 wide, 1 tall)
// rather than needing an extra row of height.
export function WeatherWeekWidget({ forecast, loading, error }) {
  const days = forecast?.daily || [];
  const hourly = forecast?.hourly || [];

  return (
    <div className="card" style={{ gridColumn: 'span 2', gridRow: 'span 2', display: 'flex', flexDirection: 'column' }}>
      <h3>This Week&apos;s Weather</h3>
      {days.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
          <ScrollerWithArrows ariaLabel="days">
            {days.map((d, i) => {
              const rain = earliestRainWindow(d.at, hourly);
              return (
                <div
                  key={i}
                  style={{
                    flexShrink: 0, width: 74, textAlign: 'center', padding: '4px 4px',
                    borderRight: i < days.length - 1 ? '1px solid var(--line)' : 'none',
                    scrollSnapAlign: 'start',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginBottom: 4 }}>{dayLabel(d.at, i)}</div>
                  <ConditionIcon icon={d.icon} alt={d.condition} size={30} />
                  <div style={{ fontSize: 12.5, marginTop: 2 }}>
                    <b>{d.maxF}°</b> <span style={{ color: 'var(--ink-soft)' }}>{d.minF}°</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: rain?.hasRain ? '#4a90c4' : 'var(--ink-soft)', marginTop: 2 }}>
                    {rain?.hasRain && `💧${rain.abbr} ${rain.pop}%`}
                    {!rain && d.pop > 0 && `💧 ${d.pop}%`}
                  </div>
                </div>
              );
            })}
          </ScrollerWithArrows>
        </div>
      )}
    </div>
  );
}
