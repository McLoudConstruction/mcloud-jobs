'use client';
import { useEffect, useState } from 'react';
import ScrollerWithArrows from './ScrollerWithArrows';

// Shared forecast fetch, used by the weather ribbon.
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

function dayLetter(ms, index) {
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

// Rough day-part buckets, checked against the browser's local time zone.
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
// limit), so this can only say *when* rain is coming for today and
// tomorrow. Returns the EARLIEST at-risk block — "rain starts this
// afternoon" is what actually matters for deciding whether a crew is
// safe outdoors in the morning.
function earliestRainWindow(dayAt, hourly) {
  const hoursForDay = hourly.filter(h => isSameLocalDay(h.at, dayAt));
  if (hoursForDay.length === 0) return null;
  for (const part of DAY_PARTS) {
    const maxPop = hoursForDay.reduce((max, h) => {
      const hour = new Date(h.at).getHours();
      return (hour >= part.startHour && hour <= part.endHour) ? Math.max(max, h.pop) : max;
    }, 0);
    if (maxPop >= RAIN_THRESHOLD_PCT) return { hasRain: true, label: part.label, pop: maxPop };
  }
  return { hasRain: false };
}

// A compact, borderless strip under the dashboard header — current
// conditions on the left, a 7-day glance on the right, with an optional
// expand for hourly detail (the operationally useful "when does rain
// start today" view) rather than showing it by default. This replaces
// the earlier three-tab weather card: that was still a boxed card
// competing for space with everything else, when weather here is meant
// to be background context you glance at, not a destination.
export function WeatherRibbon({ forecast, loading, error }) {
  const [expanded, setExpanded] = useState(false);
  const c = forecast?.current;
  const days = (forecast?.daily || []).slice(0, 7);
  const hourly = forecast?.hourly || [];

  if (loading) return <div className="dash-section weather-ribbon"><div className="empty-state">Loading weather…</div></div>;
  if (error) return <div className="dash-section weather-ribbon"><div className="empty-state">{error}</div></div>;
  if (!c) return null;

  return (
    <div className="dash-section weather-ribbon">
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <ConditionIcon icon={c.icon} alt={c.description} size={40} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--heading)', lineHeight: 1 }}>{c.tempF}°F</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'capitalize' }}>{c.description} · Wind {c.windMph} mph</div>
            {forecast?.locationName && (
              <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 1 }}>📍 {forecast.locationName}</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 4px', flex: 1 }}>
          {days.map((d, i) => {
            const rain = earliestRainWindow(d.at, hourly);
            return (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{dayLetter(d.at, i)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}>
                  <ConditionIcon icon={d.icon} alt={d.condition} size={34} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)', lineHeight: 1.25 }}>{d.maxF}°</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.25 }}>{d.minF}°</div>
                  </div>
                </div>
                {rain?.hasRain && <div style={{ fontSize: 9.5, color: '#4a90c4', marginTop: 2 }}>💧 {rain.label} {rain.pop}%</div>}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setExpanded(e => !e)}
          style={{ flexShrink: 0 }}
        >
          {expanded ? 'Hide hourly ▴' : 'Hourly ▾'}
        </button>
      </div>

      {expanded && hourly.length > 0 && (
        <div style={{ marginTop: 14, height: 90 }}>
          <ScrollerWithArrows ariaLabel="hours">
            {hourly.slice(0, 24).map((h, i) => (
              <div
                key={i}
                style={{
                  flexShrink: 0, width: 68, textAlign: 'center', padding: '4px 4px',
                  borderRight: i < 23 ? '1px solid var(--line)' : 'none',
                  scrollSnapAlign: 'start',
                }}
              >
                <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', marginBottom: 4 }}>{hourLabel(h.at)}</div>
                <ConditionIcon icon={h.icon} alt={h.condition} size={26} />
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--heading)', marginTop: 2 }}>{h.tempF}°</div>
                <div style={{ fontSize: 9, color: '#4a90c4', marginTop: 2 }}>💧{h.pop}%</div>
              </div>
            ))}
          </ScrollerWithArrows>
        </div>
      )}
    </div>
  );
}
