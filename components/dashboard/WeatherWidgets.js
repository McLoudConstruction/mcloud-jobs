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

          <div ref={scrollerRef} style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollSnapType: 'x mandatory', flex: 1 }}>
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

export function WeatherWeekWidget({ forecast, loading, error }) {
  const days = forecast?.daily || [];
  return (
    <div className="card">
      <h3>This Week&apos;s Weather</h3>
      {days.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {days.map((d, i) => (
            <div key={i} style={{ flexShrink: 0, textAlign: 'center', minWidth: 56 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{dayLabel(d.at, i)}</div>
              <ConditionIcon icon={d.icon} alt={d.condition} />
              <div style={{ fontSize: 12 }}>
                <b>{d.maxF}°</b> <span style={{ color: 'var(--ink-soft)' }}>{d.minF}°</span>
              </div>
              {d.pop > 0 && <div style={{ fontSize: 9.5, color: 'var(--accent)' }}>{d.pop}% rain</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

