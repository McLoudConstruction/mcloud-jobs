'use client';
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// Lets staff review, job by job, who hasn't activated a portal account yet
// and choose exactly who to invite — never an all-or-nothing blast.
// Selection starts empty on purpose; sending is always something staff
// opt into per row (or per checked batch), not something this panel does
// on their behalf.
export default function BackfillPortalInvitesPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null); // { candidates, totalCustomers, alreadyActivated, totalJobsScanned }
  const [selected, setSelected] = useState(new Set()); // emails
  const [sendingEmail, setSendingEmail] = useState(null); // single-row send in flight
  const [sendingBatch, setSendingBatch] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [statusByEmail, setStatusByEmail] = useState({}); // email -> 'sent' | 'failed'

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
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(email) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  function toggleAllVisible() {
    if (!summary?.candidates?.length) return;
    const allSelected = summary.candidates.every(c => selected.has(c.email));
    setSelected(allSelected ? new Set() : new Set(summary.candidates.map(c => c.email)));
  }

  async function sendOne(candidate) {
    setSendingEmail(candidate.email);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/portal/create-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session?.access_token, email: candidate.email, customerName: candidate.customerName, jobId: candidate.jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setStatusByEmail(prev => ({ ...prev, [candidate.email]: 'sent' }));
      setSummary(prev => prev && { ...prev, candidates: prev.candidates.filter(c => c.email !== candidate.email) });
      setSelected(prev => { const next = new Set(prev); next.delete(candidate.email); return next; });
    } catch {
      setStatusByEmail(prev => ({ ...prev, [candidate.email]: 'failed' }));
    } finally {
      setSendingEmail(null);
    }
  }

  async function sendSelected() {
    const toSend = (summary?.candidates || []).filter(c => selected.has(c.email));
    if (toSend.length === 0) return;
    if (!confirm(`Send an activation invite to ${toSend.length} selected customer${toSend.length === 1 ? '' : 's'}?`)) return;

    setSendingBatch(true);
    const { data: { session } } = await supabase.auth.getSession();
    for (let i = 0; i < toSend.length; i++) {
      const c = toSend[i];
      setProgress({ done: i, total: toSend.length });
      try {
        const res = await fetch('/api/portal/create-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session?.access_token, email: c.email, customerName: c.customerName, jobId: c.jobId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setStatusByEmail(prev => ({ ...prev, [c.email]: 'sent' }));
      } catch {
        setStatusByEmail(prev => ({ ...prev, [c.email]: 'failed' }));
      }
    }
    setProgress({ done: toSend.length, total: toSend.length });
    setSendingBatch(false);
    setSelected(new Set());
    await load();
  }

  if (loading) return <div className="card"><h3>Portal Activation — Not Yet Invited</h3><div className="empty-state">Checking who still needs an invite…</div></div>;

  const candidates = summary?.candidates || [];
  const allVisibleSelected = candidates.length > 0 && candidates.every(c => selected.has(c.email));

  return (
    <div className="card">
      <h3>Portal Activation — Not Yet Invited</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Every active job whose customer hasn't set up a portal account yet, one row per opportunity —
        nothing sends unless you pick it. Check off a few and send them together, or send one at a time.
      </div>

      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      {summary && (
        <div style={{ fontSize: 12.5, marginBottom: 14, color: 'var(--ink-soft)' }}>
          {summary.alreadyActivated} of {summary.totalCustomers} customer{summary.totalCustomers === 1 ? '' : 's'} across {summary.totalJobsScanned} active job{summary.totalJobsScanned === 1 ? '' : 's'} already activated.
        </div>
      )}

      {candidates.length === 0 && !loading && (
        <div className="empty-state">Everyone with an active job has already been invited or activated.</div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="data-table-wrap">
            <table className="data-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all" />
                  </th>
                  <th style={{ width: 90 }}>Job #</th>
                  <th style={{ width: 170 }}>Customer</th>
                  <th>Email</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => {
                  const status = statusByEmail[c.email];
                  return (
                    <tr key={c.email}>
                      <td>
                        <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(c.email)} onChange={() => toggle(c.email)} disabled={sendingBatch || sendingEmail === c.email} />
                      </td>
                      <td>{c.jobNumber ? `#${c.jobNumber}` : '—'}</td>
                      <td>{c.customerName || '—'}</td>
                      <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</td>
                      <td>
                        {status === 'sent' ? (
                          <span style={{ fontSize: 11, color: '#3a6b45', fontWeight: 600 }}>✓ Sent</span>
                        ) : status === 'failed' ? (
                          <span style={{ fontSize: 11, color: '#a13f3f', fontWeight: 600 }}>Failed</span>
                        ) : (
                          <button className="btn btn-sm" onClick={() => sendOne(c)} disabled={sendingBatch || sendingEmail === c.email}>
                            {sendingEmail === c.email ? 'Sending…' : 'Send'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sendingBatch && progress && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>
              Sending… {progress.done} of {progress.total}
            </div>
          )}

          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={sendSelected} disabled={sendingBatch || selected.size === 0}>
              {sendingBatch ? 'Sending…' : `Send to ${selected.size} Selected`}
            </button>
            <button className="btn btn-sm" onClick={load} disabled={sendingBatch}>Refresh</button>
          </div>
        </>
      )}
    </div>
  );
}
