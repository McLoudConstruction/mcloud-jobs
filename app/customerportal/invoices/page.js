'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import PaymentFlow from '../../../components/PaymentFlow';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';

function fmtMoney(v) {
  if (!v) return '—';
  return '$' + Number(v).toLocaleString('en-US');
}

export default function CustomerInvoicesPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, jobsLoaded, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [draws, setDraws] = useState([]);
  const [paidFlash, setPaidFlash] = useState('');

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('invoices').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: true }).then(({ data }) => { if (data) setDraws(data); });
    load();
    const channel = supabase.channel(`portal-invoices-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  if (loading || !session) return null;
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  const hasSingleInvoice = draws.length === 0 && job?.invoice_status !== 'not_sent' && job?.invoice_amount;
  // Draws the customer is actually allowed to see — a draw only becomes
  // visible to them once it's been sent; until then it's still admin-side
  // prep work and shouldn't show up here at all (not even with a "not sent
  // yet" status, which was leaking internal state onto the portal).
  const visibleDraws = draws.filter(d => d.status !== 'not_sent');

  function handlePaymentSuccess(status) {
    setPaidFlash(status === 'succeeded' ? 'Payment received, thank you!' : "Payment is processing — we'll update this once it clears.");
    setTimeout(() => setPaidFlash(''), 6000);
  }

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <div className="dash-section" style={{ paddingTop: 0 }}>
            <h3>Invoices</h3>

            {paidFlash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginBottom: 10 }}>{paidFlash}</div>}

            {visibleDraws.length === 0 && !hasSingleInvoice && (
              <div className="empty-state">No invoices issued yet.</div>
            )}

            {visibleDraws.map(d => (
              <div key={d.id} className="portal-invoice-row">
                <div className="portal-invoice-row-top">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--heading)' }}>{d.description || 'Draw'}</div>
                    <div style={{ fontSize: 11.5, color: d.status === 'paid' ? 'var(--money)' : 'var(--ink-soft)', fontWeight: d.status === 'paid' ? 600 : 400, marginTop: 2 }}>
                      {d.status === 'paid' ? 'Paid' : 'Awaiting payment'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(d.amount)}</div>
                    <a href={`/jobs/${job.id}/invoices/${d.id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: 'var(--gold)', fontWeight: 600 }}>
                      View {d.description || 'Draw'} ↗
                    </a>
                  </div>
                </div>
                {d.status === 'sent' && (
                  <div style={{ marginTop: 10 }}>
                    <PaymentFlow jobId={job.id} invoiceId={d.id} amountDue={Number(d.amount)} createdBy="customer" onSuccess={handlePaymentSuccess} />
                  </div>
                )}
              </div>
            ))}

            {hasSingleInvoice && (
              <div className="portal-invoice-row">
                <div className="portal-invoice-row-top">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--heading)' }}>Invoice</div>
                    <div style={{ fontSize: 11.5, color: job.invoice_status === 'paid' ? 'var(--money)' : 'var(--ink-soft)', fontWeight: job.invoice_status === 'paid' ? 600 : 400, marginTop: 2 }}>
                      {job.invoice_status === 'paid' ? 'Paid' : 'Awaiting payment'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(job.invoice_amount)}</div>
                    <a href={`/jobs/${job.id}/invoice`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: 'var(--gold)', fontWeight: 600 }}>View Invoice ↗</a>
                  </div>
                </div>
                {job.invoice_status === 'sent' && (
                  <div style={{ marginTop: 10 }}>
                    <PaymentFlow jobId={job.id} invoiceId={null} amountDue={Number(job.invoice_amount)} createdBy="customer" onSuccess={handlePaymentSuccess} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </CustomerPortalShell>
  );
}
