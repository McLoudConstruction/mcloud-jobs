'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';

const NEEDS_PRICING_STAGES = ['new', 'inspected', 'proposal_delivered'];

export default function EstimatingWorklistPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) return;
    supabase.from('jobs').select('id, job_number, customer_name, project_address, stage, contract_price').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setJobs(data);
    });
  }, [session]);

  if (loading || !session) return null;

  const needsPricing = jobs.filter(j => NEEDS_PRICING_STAGES.includes(j.stage) && !j.contract_price);
  const pool = showAll ? jobs : needsPricing;

  const filtered = pool.filter(j => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (j.job_number || '').toLowerCase().includes(term) || (j.customer_name || '').toLowerCase().includes(term);
  });

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 8px', color: 'var(--heading)' }}>Estimating</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          {showAll ? 'Every job.' : "Jobs that don't have a contract price set yet — pick one to build its estimate."} Estimating itself now lives on the job's own Estimate tab.
        </div>

        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className={`btn btn-sm ${!showAll ? 'btn-primary' : ''}`} onClick={() => setShowAll(false)}>Needs Pricing ({needsPricing.length})</button>
          <button className={`btn btn-sm ${showAll ? 'btn-primary' : ''}`} onClick={() => setShowAll(true)}>All Jobs</button>
        </div>

        <div className="search-bar">
          <input placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">{showAll ? 'No jobs found.' : "Nothing needs pricing right now — nice."}</div>}
        {filtered.length > 0 && (
          <DataTable
            getRowKey={j => j.id}
            onRowClick={j => window.location.href = `/jobs/${j.id}?tab=Estimate`}
            rows={filtered}
            columns={[
              { key: 'job_number', label: 'Job #', defaultWidth: 100, render: j => `#${j.job_number}` },
              { key: 'customer_name', label: 'Customer', defaultWidth: 200, render: j => j.customer_name || 'Unnamed' },
              { key: 'project_address', label: 'Address', defaultWidth: 250, render: j => j.project_address || '—' },
              { key: 'stage', label: 'Stage', defaultWidth: 130, render: j => j.stage || '—' },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
