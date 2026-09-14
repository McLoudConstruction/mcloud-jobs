'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import { formattedProjectNumber } from '../../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function WeatherRiskPage() {
  const { session, loading } = useRequireAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    fetch('/api/dashboard/weather-risk')
      .then(res => res.json())
      .then(json => {
        if (!mounted) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(err => mounted && setError(err.message));
    return () => { mounted = false; };
  }, [session]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Weather-Flagged Phases</h2>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16, maxWidth: 640 }}>
          Every outdoor schedule phase, across all active jobs, whose forecast window (roughly the next 8 days) hits a conflict with that trade's weather thresholds. A phase scheduled further out simply isn't checkable yet, so it won't appear here until it's closer.
        </div>

        {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 12 }}>{error}</div>}

        {!data && !error && <div className="empty-state">Checking forecasts…</div>}

        {data && data.flagged.length === 0 && (
          <div className="card">
            <div className="empty-state">Nothing flagged right now — every outdoor phase within the checkable window looks clear.</div>
          </div>
        )}

        {data && data.flagged.length > 0 && (
          <div className="card">
            {data.flagged.map((f, i) => (
              <div
                key={`${f.phaseId}`}
                style={{ padding: '12px 0', borderBottom: i < data.flagged.length - 1 ? '1px solid var(--line)' : 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {f.phaseLabel} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>({f.trade})</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {formattedProjectNumber({ job_number: f.jobNumber })} · {f.customerName || 'Unnamed customer'} · {fmtDate(f.startDate)} – {fmtDate(f.endDate)}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 4, maxWidth: 480 }}>
                      ⚠ Risk on {fmtDate(f.date)}: {f.reasons.join(' ')}
                    </div>
                  </div>
                  <Link href={`/jobs/${f.jobId}?tab=schedule`} className="btn btn-sm" style={{ flexShrink: 0 }}>
                    View schedule →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
