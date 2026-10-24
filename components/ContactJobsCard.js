'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { jobsOfContact, searchJobs, setJobContact, jobKindLabel, MIGRATION_HINT } from '../lib/jobContact';
import { STAGE_LABELS, formattedProjectNumber } from '../lib/constants';

// Jobs linked to one person, on the Overview tab of the Person popup (migration 173).
//
// Meant for the case where a commercial contact hires us for their own house: the job is residential
// and the person stays a commercial contact. A job is linked from here with "+ Link a job", or from
// the job's own Customer card. Removing a link never touches the job.

export default function ContactJobsCard({ contactId, onChanged }) {
  const [rows, setRows] = useState(null);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!contactId) { setRows([]); return; }
    const res = await jobsOfContact(contactId);
    setMissing(res.missing);
    setError(res.error || '');
    setRows(res.rows);
  }, [contactId]);

  useEffect(() => {
    setRows(null); setAdding(false); setTerm(''); setResults([]); setMessage(''); setError('');
    load();
  }, [load]);

  useEffect(() => {
    if (!adding) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchJobs(term, (rows || []).map(r => r.id));
      if (!cancelled) setResults(found);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, adding, rows]);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(''), 3500);
  }

  async function add(job) {
    setBusy(true); setError('');
    const res = await setJobContact(job.id, contactId);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setAdding(false); setTerm(''); setResults([]);
    flash(`Linked ${formattedProjectNumber(job)}.`);
    await load();
    if (onChanged) onChanged();
  }

  async function remove(job) {
    if (!confirm(`Unlink ${formattedProjectNumber(job)} from this person? The job is not changed.`)) return;
    setBusy(true); setError('');
    const res = await setJobContact(job.id, null);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    flash('Unlinked.');
    await load();
    if (onChanged) onChanged();
  }

  if (!contactId) return null;
  const count = rows ? rows.length : 0;

  return (
    <div className="contact-history-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h4 style={{ margin: 0 }}>Jobs{rows && count > 0 ? ` (${count})` : ''}</h4>
        {!missing && !adding && (
          <button type="button" className="btn btn-sm" onClick={() => { setAdding(true); setError(''); }} disabled={busy}>+ Link a job</button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '2px 0 8px' }}>
        Jobs for this person, such as a residential job at their own house. They stay a commercial contact.
      </div>

      {missing && <div style={{ fontSize: 12.5, color: '#a13f3f' }}>{MIGRATION_HINT}</div>}
      {rows === null && !missing && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}
      {rows && rows.length === 0 && !missing && <div className="empty-state">No jobs linked yet.</div>}

      {rows && rows.map(job => (
        <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)', minWidth: 0 }}>
          <Link href={`/jobs/${job.id}`} style={{ minWidth: 0, flex: 1, color: 'inherit', textDecoration: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
              {formattedProjectNumber(job)}
              <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{jobKindLabel(job)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
              {[job.customer_name, job.project_address].filter(Boolean).join('  ·  ') || 'No customer or address yet'}
            </div>
          </Link>
          <span className={`badge badge-${job.stage}`} style={{ flexShrink: 0 }}>{STAGE_LABELS[job.stage] || job.stage}</span>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(job)} disabled={busy}>Unlink</button>
        </div>
      ))}

      {adding && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginTop: 10 }}>
          <label style={{ marginTop: 0 }}>Find a job</label>
          <input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Customer name, project number or address" />
          {term.trim().length >= 2 && results.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>No other jobs match.</div>
          )}
          {results.map(job => (
            <button
              key={job.id}
              type="button"
              onClick={() => add(job)}
              disabled={busy}
              style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px 4px', borderBottom: '1px solid var(--line)' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{formattedProjectNumber(job)}  ·  {jobKindLabel(job)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[job.customer_name, job.project_address].filter(Boolean).join('  ·  ')}</div>
            </button>
          ))}
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { setAdding(false); setTerm(''); setResults([]); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 6 }}>{message}</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
