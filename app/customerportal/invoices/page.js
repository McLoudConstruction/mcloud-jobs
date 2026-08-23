'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import PaymentFlow from '../../../components/PaymentFlow';

function fmtMoney(v) {
  if (!v) return '—';
  return '$' + Number(v).toLocaleString('en-US');
}

export default function CustomerInvoicesPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [draws, setDraws] = useState([]);
  const [payingId, setPayingId] = useState(null); // draw id, or 'single' for the single-invoice model
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

  const hasSingleInvoice = draws.length === 0 && job?.invoice_status !== 'not_sent' && job?.invoice_amount;

  function handlePaymentSuccess(status) {
    setPayingId(null);
    setPaidFlash(status === 'succeeded' ? 'Payment received, thank you!' : "Payment is processing — we'll update this once it clears.");
    setTimeout(() => setPaidFlash(''), 6000);
  }

  return (
    <CustomerPortalShell>
      <div className="container" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <div className="card">
            <h3>Invoices</h3>

            {draws.filter(d => d.status !== 'not_sent').map(d => (
              <a key={d.id} href={`/jobs/${job.id}/invoices/${d.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ marginBottom: 8, marginRight: 8 }}>
                View {d.description || 'Draw'} ↗
              </a>
            ))}
            {hasSingleInvoice && (
              <a href={`/jobs/${job.id}/invoice`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Invoice ↗</a>
            )}

            {paidFlash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 10 }}>{paidFlash}</div>}

            {draws.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {draws.map(d => (
                  <div key={d.id} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>{d.description || 'Draw'}</span>
                      <span style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(d.amount)}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 0 }}>
                      Status: {d.status === 'paid' ? 'Paid' : d.status === 'sent' ? 'Unpaid' : 'Not yet sent'}
                    </p>
                    {d.status === 'sent' && payingId !== d.id && (
                      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setPayingId(d.id)}>Pay Now</button>
                    )}
                    {payingId === d.id && (
                      <div style={{ marginTop: 14 }}>
                        <PaymentFlow jobId={job.id} invoiceId={d.id} amountDue={Number(d.amount)} createdBy="customer" onSuccess={handlePaymentSuccess} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {hasSingleInvoice && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: '14px 16px', marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>Invoice Amount</span>
                  <span style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(job.invoice_amount)}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 0 }}>
                  Status: {job.invoice_status === 'paid' ? 'Paid' : 'Unpaid'}
                </p>
                {job.invoice_status === 'sent' && payingId !== 'single' && (
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setPayingId('single')}>Pay Now</button>
                )}
                {payingId === 'single' && (
                  <div style={{ marginTop: 14 }}>
                    <PaymentFlow jobId={job.id} invoiceId={null} amountDue={Number(job.invoice_amount)} createdBy="customer" onSuccess={handlePaymentSuccess} />
                  </div>
                )}
              </div>
            )}

            {draws.length === 0 && !hasSingleInvoice && (
              <div className="empty-state">No invoices issued yet.</div>
            )}
          </div>
        )}
      </div>
    </CustomerPortalShell>
  );
}
