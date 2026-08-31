'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import { STAGE_ORDER, STAGE_LABELS, formattedProjectNumber } from '../../lib/constants';

const STAGES = ['all', ...STAGE_ORDER];
const TAB_LABELS = { all: 'All', ...STAGE_LABELS };

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function JobTrackerPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [view, setView] = useState('active'); // 'active' | 'lost'
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) return;

    let mounted = true;
    const load = () =>
      supabase.from('jobs').select('*').order('created_at', { ascending: false }).then(({ data }) => {
        if (mounted && data) setJobs(data);
      });
    load();

    const channel = supabase
      .channel('jobs-tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [session]);

  const activeJobs = useMemo(() => jobs.filter(j => j.stage !== 'lost'), [jobs]);
  const lostJobs = useMemo(() => jobs.filter(j => j.stage === 'lost'), [jobs]);

  const filtered = useMemo(() => {
    const base = view === 'lost' ? lostJobs : activeJobs;
    return base.filter(j => {
      if (view === 'active' && stage !== 'all' && j.stage !== stage) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (j.job_number || '').toLowerCase().includes(q) ||
        (j.estimate_number || '').toLowerCase().includes(q) ||
        (j.customer_name || '').toLowerCase().includes(q) ||
        (j.project_address || '').toLowerCase().includes(q) ||
        (j.loss_reason || '').toLowerCase().includes(q)
      );
    });
  }, [activeJobs, lostJobs, view, stage, search]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Jobs</h2>
          <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
        </div>

        <div className="stage-tabs" style={{ marginBottom: 14 }}>
          <button className={`stage-tab ${view === 'active' ? 'active' : ''}`} onClick={() => setView('active')}>
            Active ({activeJobs.length})
          </button>
          <button className={`stage-tab ${view === 'lost' ? 'active' : ''}`} onClick={() => setView('lost')}>
            Closed Lost ({lostJobs.length})
          </button>
        </div>

        <div className="search-bar">
          <input
            placeholder={view === 'lost' ? 'Search by estimate #, customer, address, or loss reason…' : 'Search by job #, customer, or address…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {view === 'active' && (
          <select value={stage} onChange={e => setStage(e.target.value)} style={{ marginBottom: 18 }}>
            {STAGES.map(s => (
              <option key={s} value={s}>
                {TAB_LABELS[s]} ({s !== 'all' ? activeJobs.filter(j => j.stage === s).length : activeJobs.length})
              </option>
            ))}
          </select>
        )}

        {filtered.length === 0 && <div className="empty-state">{view === 'lost' ? 'Nothing here yet.' : 'No jobs here yet.'}</div>}

        {filtered.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
            <div className="job-main">
              <span className="job-number">{formattedProjectNumber(job)}</span>
              <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
              <span className="job-address">{job.project_address || 'No address yet'}</span>
              {view === 'lost' && job.loss_reason && (
                <span className="job-address" style={{ color: 'var(--ink-soft)' }}>Loss reason: {job.loss_reason}</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {view === 'active' && job.job_type && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{job.job_type}</span>}
              {view === 'active' && job.over_budget_notified && <span className="badge badge-declined" style={{ fontSize: 10 }}>Over Budget</span>}
              <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
              {view === 'lost' && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{fmtDate(job.lost_at)}</span>}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

