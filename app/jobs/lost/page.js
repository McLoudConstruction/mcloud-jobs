'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { formattedProjectNumber } from '../../../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ClosedLostPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) return;

    let mounted = true;
    const load = () =>
      supabase.from('jobs').select('*').eq('stage', 'lost').order('lost_at', { ascending: false }).then(({ data }) => {
        if (mounted && data) setJobs(data);
      });
    load();

    const channel = supabase
      .channel('jobs-lost')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [session]);

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(j =>
      (j.estimate_number || '').toLowerCase().includes(q) ||
      (j.customer_name || '').toLowerCase().includes(q) ||
      (j.project_address || '').toLowerCase().includes(q) ||
      (j.loss_reason || '').toLowerCase().includes(q)
    );
  }, [jobs, search]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Closed Lost</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              Opportunities that didn't convert before Approval. Kept separate from the active Job Tracker.
            </div>
          </div>
          <Link href="/jobs" className="btn btn-sm">← Back to Jobs</Link>
        </div>

        <div className="search-bar">
          <input
            placeholder="Search by estimate #, customer, address, or loss reason…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {filtered.length === 0 && <div className="empty-state">Nothing here yet.</div>}

        {filtered.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
            <div className="job-main">
              <span className="job-number">{formattedProjectNumber(job)}</span>
              <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
              <span className="job-address">{job.project_address || 'No address yet'}</span>
              {job.loss_reason && (
                <span className="job-address" style={{ color: 'var(--ink-soft)' }}>Loss reason: {job.loss_reason}</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className="badge badge-lost">Closed Lost</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtDate(job.lost_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
