'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import PlansPanel from '../../components/PlansPanel';
import { jobHref } from '../../lib/links';

// Standalone entry to the floorplan tool. The tool itself is FloorplanPanel
// (also embedded in each job under the Sketch tab). Open as
// /floorplan?job=<job id>; with no job this is just a job picker.

export default function FloorplanPage() {
  const { session, loading } = useRequireAuth();
  const [jobId, setJobId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('job');
    setJobId(q || '');
  }, []);

  useEffect(() => {
    if (!session || jobId === null || jobId) return;
    supabase.from('jobs').select('id, estimate_number, customer_name, project_address').order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setJobs(data || []));
  }, [session, jobId]);

  if (loading || !session || jobId === null) return null;

  if (!jobId) {
    const term = search.trim().toLowerCase();
    const list = jobs.filter(j => !term || [j.estimate_number, j.customer_name, j.project_address].some(v => (v || '').toLowerCase().includes(term)));
    return (
      <AppShell>
        <div className="container">
          <h2 style={{ color: 'var(--heading)' }}>Sketch</h2>
          <p style={{ color: 'var(--muted, #666)' }}>Pick a job to sketch a floorplan or upload an existing sketch for an AI takeoff. You can also open it from any job under Sketch.</p>
          <input className="input" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 420, marginBottom: 12 }} />
          {list.map(j => (
            <div key={j.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border, #ddd)' }}>
              <Link href={jobHref(j.id, 'floorplan')}>{j.estimate_number || 'Job'} — {j.customer_name || ''}</Link>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{j.project_address}</div>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container" style={{ maxWidth: 1400 }}>
        <PlansPanel jobId={jobId} />
      </div>
    </AppShell>
  );
}
