'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { personOfJob, setJobContact, MIGRATION_HINT } from '../lib/jobContact';
import { searchPeople } from '../lib/contactProperties';

// "Linked contact" on a job's Customer card (migration 173): the person in People this job belongs to.
//
// For a residential job at a commercial contact's own house, link the contact here. The job stays
// residential, the person stays a commercial contact, and the job shows on their Overview. The typed
// in customer fields below are not changed by the link. Saves at once, it does not wait for Edit.

export default function JobContactLink({ jobId }) {
  const [person, setPerson] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    personOfJob(jobId).then(res => {
      if (cancelled) return;
      setPerson(res.person);
      setMissing(res.missing);
      setError(res.error || '');
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!picking) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchPeople(term, person ? [person.id] : []);
      if (!cancelled) setResults(found);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, picking, person]);

  async function choose(p) {
    setBusy(true); setError('');
    const res = await setJobContact(jobId, p.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setPerson({ ...p, contact_type: p.contact_type });
    setPicking(false); setTerm(''); setResults([]);
  }

  async function unlink() {
    if (!confirm('Unlink this contact from the job? The job and the contact are not changed.')) return;
    setBusy(true); setError('');
    const res = await setJobContact(jobId, null);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setPerson(null);
  }

  if (!loaded) return null;
  if (missing) {
    return <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '10px 0' }}>{MIGRATION_HINT}</div>;
  }

  const detail = person ? [person.contact_type, person.management_company, person.position].filter(Boolean).join('  ·  ') : '';

  return (
    <div style={{ margin: '10px 0 14px', padding: '10px 12px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Linked contact</div>
          {person ? (
            <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>
              <Link href={`/customers?contact=${person.id}`} style={{ color: 'inherit' }}>{person.name}</Link>
              {detail && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--ink-soft)' }}>{detail}</span>}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              Not linked to anyone in People. Link a commercial contact here when they hire us for their own home.
            </div>
          )}
        </div>
        {!picking && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { setPicking(true); setError(''); }} disabled={busy}>{person ? 'Change' : 'Link a contact'}</button>
            {person && <button type="button" className="btn btn-sm" onClick={unlink} disabled={busy}>Unlink</button>}
          </div>
        )}
      </div>

      {picking && (
        <div style={{ marginTop: 8 }}>
          <input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Find a person by name or email" />
          {term.trim().length >= 2 && results.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>No other people match.</div>
          )}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => choose(p)}
              disabled={busy}
              style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px 4px', borderBottom: '1px solid var(--line)' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[p.position, p.management_company, p.contact_email].filter(Boolean).join('  ·  ')}</div>
            </button>
          ))}
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { setPicking(false); setTerm(''); setResults([]); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
