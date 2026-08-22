'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import { STAGE_ORDER, STAGE_LABELS, formattedProjectNumber } from '../../lib/constants';

const STAGES = ['all', ...STAGE_ORDER];
const TAB_LABELS = { all: 'All', ...STAGE_LABELS };

export default function JobTrackerPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) return;

    let mounted = true;
    supabase.from('jobs').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      if (mounted && data) setJobs(data);
    });

    const channel = supabase
      .channel('jobs-tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        supabase.from('jobs').select('*').order('created_at', { ascending: false }).then(({ data }) => {
          if (mounted && data) setJobs(data);
        });
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [session]);

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (stage !== 'all' && j.stage !== stage) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (j.job_number || '').toLowerCase().includes(q) ||
        (j.customer_name || '').toLowerCase().includes(q) ||
        (j.project_address || '').toLowerCase().includes(q)
      );
    });
  }, [jobs, stage, search]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Jobs</h2>
          <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
        </div>

        <div className="search-bar">
          <input
            placeholder="Search by job #, customer, or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select value={stage} onChange={e => setStage(e.target.value)} style={{ marginBottom: 18 }}>
          {STAGES.map(s => (
            <option key={s} value={s}>
              {TAB_LABELS[s]} ({s !== 'all' ? jobs.filter(j => j.stage === s).length : jobs.length})
            </option>
          ))}
        </select>

        {filtered.length === 0 && <div className="empty-state">No jobs here yet.</div>}

        {filtered.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
            <div className="job-main">
              <span className="job-number">{formattedProjectNumber(job)}</span>
              <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
              <span className="job-address">{job.project_address || 'No address yet'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {job.job_type && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{job.job_type}</span>}
              {job.over_budget_notified && <span className="badge badge-declined" style={{ fontSize: 10 }}>Over Budget</span>}
              <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
