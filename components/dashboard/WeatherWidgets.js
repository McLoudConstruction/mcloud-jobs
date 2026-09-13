'use client';
import { useEffect, useState } from 'react';

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
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric' });
}

function ConditionIcon({ icon, alt }) {
  if (!icon) return null;
  return <img src={`https://openweathermap.org/img/wn/${icon}.png`} alt={alt || ''} width={36} height={36} style={{ display: 'block' }} />;
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
          <ConditionIcon icon={c.icon} alt={c.description} />
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

export function WeatherHourlyWidget({ forecast, loading, error }) {
  const hours = (forecast?.hourly || []).slice(0, 24);
  return (
    <div className="card">
      <h3>Today&apos;s Weather — Hourly</h3>
      {hours.length === 0 ? <WeatherEmptyState loading={loading} error={error} /> : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
          {hours.map((h, i) => (
            <div key={i} style={{ flexShrink: 0, textAlign: 'center', minWidth: 42 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{hourLabel(h.at)}</div>
              <ConditionIcon icon={h.icon} alt={h.condition} />
              <div style={{ fontSize: 12, fontWeight: 600 }}>{h.tempF}°</div>
              {h.pop > 0 && <div style={{ fontSize: 9.5, color: 'var(--accent)' }}>{h.pop}%</div>}
            </div>
          ))}
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
