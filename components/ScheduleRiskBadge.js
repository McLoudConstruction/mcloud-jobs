'use client';
import { useState } from 'react';
import { aiFetch } from '../lib/aiFetch';

const LEVEL_STYLE = {
  low: { color: '#2f4858', bg: '#e6edf1', label: 'Low' },
  medium: { color: '#a17c3f', bg: '#f7efdc', label: 'Medium' },
  high: { color: '#a13f3f', bg: '#fbeae7', label: 'High' },
};

// On-demand AI read of a job's schedule risk — past delays on this job,
// forecasted weather against trade rules, and reliability notes on the subs
// assigned to the next couple weeks of work. Checked on request rather than
// automatically, so it doesn't burn an AI call every time this tab opens.
export default function ScheduleRiskBadge({ jobId }) {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function check() {
    setChecking(true);
    setError('');
    try {
      const data = await aiFetch('/api/ai/schedule-risk', { jobId });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card">
      <h3>Schedule risk check</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        Reads past delays on this job, upcoming weather against trade rules, and reliability notes on assigned subs — a heads-up, not a prediction.
      </div>
      <button className="btn btn-sm" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check schedule risk'}</button>
      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
      {result && (
        result.risk_level === 'none' ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>Nothing notable right now.</div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap', ...(LEVEL_STYLE[result.risk_level] ? { color: LEVEL_STYLE[result.risk_level].color, background: LEVEL_STYLE[result.risk_level].bg } : {}) }}>
              {LEVEL_STYLE[result.risk_level]?.label || result.risk_level}
            </span>
            <span>{result.note}</span>
          </div>
        )
      )}
    </div>
  );
}
