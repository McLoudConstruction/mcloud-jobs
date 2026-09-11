'use client';
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// One-time (or occasional) bulk action: finds every existing customer on
// an active job who hasn't gone through the new activation flow yet, and
// sends each of them a real "create your account" invite. Sends happen one
// at a time from the browser, the same pattern already used for per-job
// bulk invites in PortalAccessCard — keeps each request short instead of
// risking a serverless timeout on one giant batch call.
export default function BackfillPortalInvitesPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null); // { candidates, totalCustomers, alreadyActivated, totalJobsScanned }
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null); // { sent, failed, failures }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/portal/backfill-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load.');
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendAll() {
    if (!summary?.candidates?.length) return;
    if (!confirm(`Send an activation invite email to ${summary.candidates.length} customer${summary.candidates.length === 1 ? '' : 's'}? This can't be undone.`)) return;

    setSending(true);
    setResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    const total = summary.candidates.length;
    let sent = 0;
    const failures = [];

    for (let i = 0; i < total; i++) {
      const c = summary.candidates[i];
      setProgress({ done: i, total });
      try {
        const res = await fetch('/api/portal/create-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session?.access_token, email: c.email, customerName: c.customerName, jobId: c.jobId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        sent++;
      } catch (err) {
        failures.push({ email: c.email, error: err.message });
      }
    }

    setProgress({ done: total, total });
    setResult({ sent, failed: failures.length, failures });
    setSending(false);
    await load();
  }

  if (loading) return <div className="card"><h3>Portal Activation Backfill</h3><div className="empty-state">Checking who still needs an invite…</div></div>;

  return (
    <div className="card">
      <h3>Portal Activation Backfill</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        A one-time (or occasional) sweep across every active job — sends a "set up your account" activation
        invite to any customer who doesn't already have one. Safe to run more than once: anyone already
        invited or activated is skipped automatically, nothing goes out twice.
      </div>

      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      {summary && (
        <div style={{ fontSize: 12.5, marginBottom: 14 }}>
          Scanned {summary.totalJobsScanned} active job{summary.totalJobsScanned === 1 ? '' : 's'} —{' '}
          {summary.alreadyActivated} customer{summary.alreadyActivated === 1 ? '' : 's'} already activated,{' '}
          <b>{summary.candidates.length} still need{summary.candidates.length === 1 ? 's' : ''} an invite</b>.
        </div>
      )}

      {sending && progress && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
          Sending… {progress.done} of {progress.total}
        </div>
      )}

      {result && (
        <div style={{ fontSize: 12.5, marginBottom: 10, color: result.failed === 0 ? '#3a6b45' : '#a13f3f' }}>
          Sent {result.sent} invite{result.sent === 1 ? '' : 's'}.
          {result.failed > 0 && ` ${result.failed} failed — check Communications Log below for details.`}
        </div>
      )}

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={sendAll} disabled={sending || loading || !summary?.candidates?.length}>
          {sending ? 'Sending…' : `Send Invites to ${summary?.candidates?.length || 0} Customer${summary?.candidates?.length === 1 ? '' : 's'}`}
        </button>
        <button className="btn btn-sm" onClick={load} disabled={sending || loading}>Refresh</button>
      </div>
    </div>
  );
}
