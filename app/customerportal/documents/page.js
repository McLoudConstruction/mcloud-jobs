'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { contractPathFor } from '../../../lib/constants';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';

// Material selections used to surface here too (a "Needs Your Attention"
// block), but now that Selections is its own persistent nav tab — see
// /customerportal/selections — showing it in both places just duplicated
// the same open item. Documents stays focused on Estimate/Contract,
// Change Orders, and Progress Updates.

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date((v || '').length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CustomerDocumentsPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [updates, setUpdates] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('job_updates').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('update_date', { ascending: false }).then(({ data }) => { if (data) setUpdates(data); });
    load();
    const channel = supabase.channel(`portal-doc-updates-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('change_orders').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('co_date', { ascending: false }).then(({ data }) => { if (data) setChangeOrders(data); });
    load();
    const channel = supabase.channel(`portal-doc-cos-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  if (loading || !session) return null;

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <>
            <div className="dash-section" style={{ paddingTop: 0 }}>
              <h3>Estimate &amp; Contract</h3>
              <div className="section-actions" style={{ marginTop: 0, flexDirection: 'column', alignItems: 'flex-start' }}>
                {job.proposal_sent_at && (
                  <a href={`/jobs/${job.id}/proposal`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Estimate ↗</a>
                )}
                {job.proposal_sent_at && !job.contract_finalized_at && (
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -4 }}>
                    Ready to move forward? Open the estimate and use the "Sign the Contract" button inside it.
                  </div>
                )}
                {job.contract_sent_at && (
                  <a href={contractPathFor(job)} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                )}
                {!job.proposal_sent_at && !job.contract_sent_at && (
                  <div className="empty-state" style={{ padding: '4px 0' }}>Nothing has been sent yet.</div>
                )}
              </div>
            </div>

            {changeOrders.length > 0 && (
              <div className="dash-section">
                <h3>Change Orders</h3>
                {changeOrders.map(co => {
                  const signed = !!(co.co_signatures || {}).owner;
                  const declined = !!co.declined_at;
                  return (
                    <div className="update-entry" key={co.id}>
                      <div className="update-date">
                        {fmtDate(co.co_date)}
                        {signed && <span style={{ color: 'var(--money)', fontWeight: 600 }}> · Signed</span>}
                        {declined && <span style={{ color: 'var(--rust)', fontWeight: 600 }}> · Declined</span>}
                      </div>
                      <p style={{ margin: 0 }}>{co.description}</p>
                      <div className="section-actions">
                        <a href={`/jobs/${job.id}/change-orders/${co.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Change Order ↗</a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="dash-section">
              <h3>Progress Updates</h3>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
                Every update we've posted on this project, most recent first.
              </div>
              {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
              {updates.map(u => (
                <div className="update-entry" key={u.id}>
                  <div className="update-date">{fmtDate(u.update_date)}</div>
                  <div className="section-actions">
                    <a href={`/jobs/${job.id}/updates/${u.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Progress Update ↗</a>
                  </div>
                </div>
              ))}
            </div>

          </>
        )}
      </div>
    </CustomerPortalShell>
  );
}
