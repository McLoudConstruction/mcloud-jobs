'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';

export default function EstimatingPickerPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) return;
    supabase.from('jobs').select('id, job_number, customer_name, project_address, stage').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setJobs(data);
    });
  }, [session]);

  if (loading || !session) return null;

  const filtered = jobs.filter(j => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (j.job_number || '').toLowerCase().includes(term) || (j.customer_name || '').toLowerCase().includes(term);
  });

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 8px', color: 'var(--heading)' }}>Estimating</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Experimental — pick a job to build a materials estimate for it.
        </div>

        <div className="search-bar">
          <input placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">No jobs found.</div>}
        {filtered.length > 0 && (
          <DataTable
            getRowKey={j => j.id}
            onRowClick={j => window.location.href = `/jobs/${j.id}/estimate`}
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
