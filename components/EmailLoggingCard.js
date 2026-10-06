'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Settings > Integrations: turn on email logging for each connected Google or
// Microsoft account. Once on, sent and received mail is scanned on the daily
// sync (or on demand here) and every message involving a saved Person,
// Property or Company address is logged on that record. Mail with no match
// is never stored.

const NAMES = { google: 'Google', microsoft: 'Microsoft' };
const BACKFILL_OPTIONS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
];

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data?.session?.access_token}`, 'Content-Type': 'application/json' };
}

function ago(value) {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function EmailLoggingCard() {
  const [accounts, setAccounts] = useState(null);
  const [backfill, setBackfill] = useState(90);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/email-sync', { headers: await authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load email logging status.');
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message);
      setAccounts([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(provider, action) {
    setBusy(`${provider}:${action}`);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/integrations/email-sync', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ provider, action, backfillDays: backfill }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That did not work.');
      if (action === 'sync_now') {
        const r = data.result || {};
        setMessage(
          r.skipped
            ? r.skipped
            : `Scanned ${r.scanned || 0} emails and logged ${r.stored || 0}.${r.caughtUp ? '' : ' There is more history to read, press Sync now again to continue.'}`
        );
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (!accounts || accounts.length === 0) return null;

  return (
    <div className="card">
      <h3>Email logging</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
        Logs sent and received email on the matching Person, Property or Company, using the email addresses saved on each record. Only emails that involve a saved address are stored. Everything else in the inbox is left alone. Runs automatically once a day.
      </div>

      {accounts.map(a => (
        <div key={a.provider} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{NAMES[a.provider]} mail{a.email ? `: ${a.email}` : ''}</div>
              {!a.hasMailScope && (
                <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 4 }}>
                  This connection does not have mail access yet. Disconnect and connect {NAMES[a.provider]} again above, then come back here.
                </div>
              )}
              {a.hasMailScope && a.enabled && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                  On. Read up to {ago(a.syncedUpTo)}. Last run {ago(a.lastRunAt)}.
                </div>
              )}
              {a.lastError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 4 }}>Last run failed: {a.lastError}</div>}
            </div>

            {a.hasMailScope && !a.enabled && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={backfill} onChange={e => setBackfill(Number(e.target.value))} style={{ width: 'auto' }} aria-label="How far back to read">
                  {BACKFILL_OPTIONS.map(o => <option key={o.days} value={o.days}>{o.label}</option>)}
                </select>
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => act(a.provider, 'enable')}>
                  {busy === `${a.provider}:enable` ? 'Turning on' : 'Turn on'}
                </button>
              </div>
            )}

            {a.hasMailScope && a.enabled && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" disabled={!!busy} onClick={() => act(a.provider, 'sync_now')}>
                  {busy === `${a.provider}:sync_now` ? 'Syncing' : 'Sync now'}
                </button>
                <button className="btn btn-sm" disabled={!!busy} onClick={() => act(a.provider, 'disable')}>Turn off</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 10 }}>{message}</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
    </div>
  );
}
