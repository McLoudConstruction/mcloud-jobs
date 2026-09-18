'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';
import { STAGE_LABELS } from '../../lib/constants';

const NEEDS_PRICING_STAGES = ['new', 'inspected', 'proposal_delivered'];

export default function EstimatingWorklistPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from('jobs').select('id, estimate_number, customer_name, project_address, stage, job_financials(contract_price)').order('created_at', { ascending: false }).then(({ data }) => {
      // Supabase's embedded-resource syntax returns job_financials as a
      // nested object here (job_financials is the parent side of a 1:1
      // via the job_id primary key) — flatten it back onto each job so
      // job.contract_price keeps working unchanged below.
      data = data?.map(j => ({ ...j, contract_price: j.job_financials?.contract_price, job_financials: undefined }));
      if (data) setJobs(data);
    });
  }, [session]);

  if (loading || !session) return null;

  // This worklist only ever shows jobs that still need pricing — once a
  // job has a contract price set, it drops off here entirely rather than
  // sticking around under an "All Jobs" view.
  const needsPricing = jobs.filter(j => NEEDS_PRICING_STAGES.includes(j.stage) && !j.contract_price);

  const filtered = needsPricing.filter(j => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (j.estimate_number || '').toLowerCase().includes(term) || (j.customer_name || '').toLowerCase().includes(term);
  });

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 8px', color: 'var(--heading)' }}>Estimating</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Jobs that don't have a contract price set yet ({needsPricing.length}).
        </div>

        <div className="search-bar">
          <input placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">Nothing needs pricing right now — nice.</div>}

        {filtered.length > 0 && isMobile && (
          <div className="entity-mobile-list">
            {filtered.map(j => (
              <button
                key={j.id}
                className="entity-mobile-row"
                onClick={() => window.location.href = `/jobs/${j.id}?tab=Estimate&section=pricing`}
              >
                <span className="entity-mobile-row-text">
                  <span className="entity-mobile-row-title">{j.customer_name || 'Unnamed'}</span>
                  <span className="entity-mobile-row-sub">
                    {j.estimate_number ? `#${j.estimate_number}` : 'No estimate #'}{j.project_address ? ` · ${j.project_address}` : ''}
                  </span>
                </span>
                <span className={`badge badge-${j.stage}`} style={{ flexShrink: 0 }}>{STAGE_LABELS[j.stage] || j.stage}</span>
                <span className="jobs-row-chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && !isMobile && (
          <DataTable
            getRowKey={j => j.id}
            onRowClick={j => window.location.href = `/jobs/${j.id}?tab=Estimate&section=pricing`}
            rows={filtered}
            columns={[
              { key: 'estimate_number', label: 'Estimate #', defaultWidth: 130, render: j => j.estimate_number ? `#${j.estimate_number}` : '—' },
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
