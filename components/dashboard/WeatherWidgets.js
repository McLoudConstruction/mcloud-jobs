'use client';
import { useEffect, useState } from 'react';
import ScrollerWithArrows from './ScrollerWithArrows';

// Shared forecast fetch, used by the one Weather card below.
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

function TodayView({ forecast, loading, error }) {
  const c = forecast?.current;
  if (!c) return <WeatherEmptyState loading={loading} error={error} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 4px' }}>
      <ConditionIcon icon={c.icon} alt={c.description} size={64} />
      <div>
        <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--heading)', lineHeight: 1 }}>{c.tempF}°F</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', textTransform: 'capitalize', marginTop: 4 }}>{c.description}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Feels like {c.feelsLikeF}°F · Wind {c.windMph} mph</div>
      </div>
    </div>
  );
}

function HourlyView({ forecast, loading, error }) {
  const hours = (forecast?.hourly || []).slice(0, 24);
  if (hours.length === 0) return <WeatherEmptyState loading={loading} error={error} />;
  return (
    <ScrollerWithArrows ariaLabel="hours">
      {hours.map((h, i) => (
        <div
          key={i}
          style={{
            flexShrink: 0, width: 78, textAlign: 'center', padding: '6px 4px',
            borderRight: i < hours.length - 1 ? '1px solid var(--line)' : 'none',
            scrollSnapAlign: 'start',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>{hourLabel(h.at)}</div>
          <ConditionIcon icon={h.icon} alt={h.condition} size={36} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--heading)', marginTop: 4 }}>{h.tempF}°</div>
          <div style={{ fontSize: 10.5, color: '#4a90c4', marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            💧 {h.pop}%
          </div>
        </div>
      ))}
    </ScrollerWithArrows>
  );
}

// Rough day-part buckets, checked against the browser's local time zone
// (no server-side timezone data needed — this renders client-side, and
// staff and jobs are assumed to be in the same time zone).
const DAY_PARTS = [
  { abbr: 'Ovn', startHour: 0, endHour: 5 },
  { abbr: 'AM', startHour: 6, endHour: 11 },
  { abbr: 'PM', startHour: 12, endHour: 17 },
  { abbr: 'Eve', startHour: 18, endHour: 23 },
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
// Returns just the EARLIEST at-risk block — "rain starts this afternoon"
// is what actually matters for deciding whether a crew is safe outdoors
// in the morning.
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

function WeekView({ forecast, loading, error }) {
  const days = forecast?.daily || [];
  const hourly = forecast?.hourly || [];
  if (days.length === 0) return <WeatherEmptyState loading={loading} error={error} />;
  return (
    <ScrollerWithArrows ariaLabel="days">
      {days.map((d, i) => {
        const rain = earliestRainWindow(d.at, hourly);
        return (
          <div
            key={i}
            style={{
              flexShrink: 0, width: 78, textAlign: 'center', padding: '6px 4px',
              borderRight: i < days.length - 1 ? '1px solid var(--line)' : 'none',
              scrollSnapAlign: 'start',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>{dayLabel(d.at, i)}</div>
            <ConditionIcon icon={d.icon} alt={d.condition} size={36} />
            <div style={{ fontSize: 14, marginTop: 4 }}>
              <b>{d.maxF}°</b> <span style={{ color: 'var(--ink-soft)' }}>{d.minF}°</span>
            </div>
            <div style={{ fontSize: 10.5, color: rain?.hasRain ? '#4a90c4' : 'var(--ink-soft)', marginTop: 3, minHeight: 14 }}>
              {rain?.hasRain && `💧${rain.abbr} ${rain.pop}%`}
              {!rain && d.pop > 0 && `💧 ${d.pop}%`}
            </div>
          </div>
        );
      })}
    </ScrollerWithArrows>
  );
}

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'hourly', label: 'Hourly' },
  { key: 'week', label: 'Week' },
];

// One card, three views, flipped between with a bordered segmented
// control (this app's established pattern for "a mode within one card" —
// see .tab-section-btn) rather than three separate cards competing for
// grid space.
export function WeatherCard({ forecast, loading, error }) {
  const [view, setView] = useState('today');

  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <div className="tab-sections" style={{ margin: '-4px 0 12px' }}>
        <h3 style={{ margin: 0 }}>Weather</h3>
        <div className="tab-sections-pills">
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              className={`tab-section-btn ${view === v.key ? 'active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ minHeight: 110 }}>
        {view === 'today' && <TodayView forecast={forecast} loading={loading} error={error} />}
        {view === 'hourly' && <HourlyView forecast={forecast} loading={loading} error={error} />}
        {view === 'week' && <WeekView forecast={forecast} loading={loading} error={error} />}
      </div>
    </div>
  );
}
