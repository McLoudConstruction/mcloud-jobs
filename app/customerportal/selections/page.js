'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CustomerSelectionsPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, jobsLoaded, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [selections, setSelections] = useState([]);

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('material_selections').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('created_at', { ascending: false }).then(({ data }) => { if (data) setSelections(data); });
    load();
    const channel = supabase.channel(`portal-selections-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  if (loading || !session) return null;
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  const pending = selections.filter(s => s.status !== 'approved');
  const chosen = selections.filter(s => s.status === 'approved');

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <>
            <div className="dash-section" style={{ paddingTop: 0 }}>
              <h3 className={pending.length > 0 ? 'dash-section-heading-rust' : ''}>Needs a Decision</h3>
              {pending.length === 0 && <div className="empty-state">Nothing waiting on you right now.</div>}
              {pending.map(s => (
                <a key={s.id} href={`/jobs/${job.id}/material-selections/${s.id}`} target="_blank" rel="noopener noreferrer" className="portal-feed-item portal-feed-item-new portal-feed-item-action">
                  <span className="portal-feed-tag">Choose Now</span>
                  <span className="portal-feed-label">{s.title}</span>
                  {s.notes && <span className="portal-feed-sub">{s.notes}</span>}
                </a>
              ))}
            </div>

            <div className="dash-section">
              <h3>Chosen</h3>
              {chosen.length === 0 && <div className="empty-state">Nothing finalized yet.</div>}
              {chosen.map(s => (
                <a key={s.id} href={`/jobs/${job.id}/material-selections/${s.id}`} target="_blank" rel="noopener noreferrer" className="portal-feed-item">
                  <span className="portal-feed-label">{s.title}</span>
                  <span className="portal-feed-date">Chosen {fmtDate(s.approved_at)}</span>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </CustomerPortalShell>
  );
}
