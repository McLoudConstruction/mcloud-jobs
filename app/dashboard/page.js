'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';

const STAGES = ['all', 'proposal', 'contract', 'active', 'invoice', 'complete'];
const STAGE_LABELS = {
  all: 'All',
  proposal: 'Proposal',
  contract: 'Contract',
  active: 'Active',
  invoice: 'Invoice',
  complete: 'Complete',
};

export default function DashboardPage() {
  const { session, loading } = useRequireAuth();
  const { settings } = useSettings();
  const router = useRouter();
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
      .channel('jobs-dashboard')
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (loading || !session) return null;

  return (
    <div>
      <div className="topbar">
        {settings.logo_url
          ? <img src={settings.logo_url} alt="Logo" style={{ height: 32, width: 'auto' }} />
          : <div className="brand">McLoud <span>Jobs</span></div>}
        <div className="topbar-actions">
          <Link href="/settings" className="btn btn-sm">Settings</Link>
          <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Jobs</h2>
          <Link href="/jobs/new" className="btn btn-primary">+ New job</Link>
        </div>

        <div className="search-bar">
          <input
            placeholder="Search by job #, customer, or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="stage-tabs">
          {STAGES.map(s => (
            <button
              key={s}
              className={`stage-tab ${stage === s ? 'active' : ''}`}
              onClick={() => setStage(s)}
            >
              {STAGE_LABELS[s]} {s !== 'all' ? `(${jobs.filter(j => j.stage === s).length})` : `(${jobs.length})`}
            </button>
          ))}
        </div>

        {filtered.length === 0 && <div className="empty-state">No jobs here yet.</div>}

        {filtered.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="job-row">
            <div className="job-main">
              <span className="job-number">#{job.job_number}</span>
              <span className="job-customer">{job.customer_name || 'Unnamed customer'}</span>
              <span className="job-address">{job.project_address || 'No address yet'}</span>
            </div>
            <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
