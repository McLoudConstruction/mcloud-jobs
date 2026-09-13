'use client';
import { useEffect, useRef, useState } from 'react';

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
          <ConditionIcon icon={c.icon} alt={c.description} size={48} />
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--heading)', lineHeight: 1 }}>{c.tempF}°F</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', textTransform: 'capitalize' }}>{c.description}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>Feels like {c.feelsLikeF}°F · Wind {c.windMph} mph</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Spans two grid columns (the dashboard grid is auto-fill, so this just
// works) and scrolls by roughly one "page" of cards per arrow click,
// rather than one card at a time.
export function WeatherHourlyWidget({ forecast, loading, error }) {
  const hours = (forecast?.hourly || []).slice(0, 24);
  const scrollerRef = useRef(null);

  function scrollByPage(direction) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <h3>Today&apos;s Weather — Hourly</h3>
      {hours.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            aria-label="Scroll earlier"
            onClick={() => scrollByPage(-1)}
            className="btn btn-sm"
            style={{ flexShrink: 0, padding: '10px 6px' }}
          >‹</button>

          <div ref={scrollerRef} className="hide-scrollbar" style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollSnapType: 'x mandatory', flex: 1 }}>
            {hours.map((h, i) => (
              <div
                key={i}
                style={{
                  flexShrink: 0, width: 84, textAlign: 'center', padding: '10px 4px',
                  borderRight: i < hours.length - 1 ? '1px solid var(--line)' : 'none',
                  scrollSnapAlign: 'start',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>{hourLabel(h.at)}</div>
                <ConditionIcon icon={h.icon} alt={h.condition} size={40} />
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--heading)', marginTop: 4 }}>{h.tempF}°</div>
                <div style={{ fontSize: 10.5, color: '#4a90c4', marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  💧 {h.pop}%
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            aria-label="Scroll later"
            onClick={() => scrollByPage(1)}
            className="btn btn-sm"
            style={{ flexShrink: 0, padding: '10px 6px' }}
          >›</button>
        </div>
      )}
    </div>
  );
}

// Rough day-part buckets, checked against the browser's local time zone
// (no server-side timezone data needed — this renders client-side, and
// staff and jobs are assumed to be in the same time zone).
const DAY_PARTS = [
  { label: 'Overnight', startHour: 0, endHour: 5 },
  { label: 'Morning', startHour: 6, endHour: 11 },
  { label: 'Afternoon', startHour: 12, endHour: 17 },
  { label: 'Evening', startHour: 18, endHour: 23 },
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
function rainTimingForDay(dayAt, hourly) {
  const hoursForDay = hourly.filter(h => isSameLocalDay(h.at, dayAt));
  if (hoursForDay.length === 0) return null;

  const blocks = DAY_PARTS
    .map(part => ({
      ...part,
      maxPop: hoursForDay.reduce((max, h) => {
        const hour = new Date(h.at).getHours();
        return (hour >= part.startHour && hour <= part.endHour) ? Math.max(max, h.pop) : max;
      }, 0),
    }))
    .filter(b => b.maxPop >= RAIN_THRESHOLD_PCT);

  if (blocks.length === 0) return { hasRain: false };
  return { hasRain: true, text: blocks.map(b => `${b.label} ${b.maxPop}%`).join(', ') };
}

export function WeatherWeekWidget({ forecast, loading, error }) {
  const days = forecast?.daily || [];
  const hourly = forecast?.hourly || [];

  return (
    <div className="card">
      <h3>This Week&apos;s Weather</h3>
      {days.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div>
          {days.map((d, i) => {
            const timing = rainTimingForDay(d.at, hourly);
            return (
              <div
                key={i}
                style={{ padding: '7px 0', borderBottom: i < days.length - 1 ? '1px solid var(--line)' : 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 46, flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>{dayLabel(d.at, i)}</div>
                  <div style={{ flexShrink: 0 }}><ConditionIcon icon={d.icon} alt={d.condition} size={24} /></div>
                  <div style={{ fontSize: 12.5 }}>
                    <b>{d.maxF}°</b> <span style={{ color: 'var(--ink-soft)' }}>{d.minF}°</span>
                  </div>
                </div>
                {(timing?.hasRain || (!timing && d.pop > 0)) && (
                  <div style={{ fontSize: 10.5, color: '#4a90c4', marginTop: 3, paddingLeft: 54 }}>
                    {timing?.hasRain ? `💧 ${timing.text}` : `💧 ${d.pop}% chance (daily estimate)`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

