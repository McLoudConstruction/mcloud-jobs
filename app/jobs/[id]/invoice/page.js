'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../lib/generatePdf';

const LOGO_SRC = '/mcloud-logo.png';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

export default function InvoiceDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadJob = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (data) setJob(data);
  }, [id]);

  useEffect(() => { if (session) loadJob(); }, [session, loadJob]);

  async function markInvoiceSent() {
    if (job.invoice_status === 'not_sent') {
      await supabase.from('jobs').update({
        invoice_status: 'sent',
        invoiced_at: job.invoiced_at || new Date().toISOString(),
      }).eq('id', id);
      loadJob();
    }
  }

  const [downloading, setDownloading] = useState(false);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Invoice-${job.job_number}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session || !job) return null;

  const milestones = job.milestones || [];
  const recipientEmail = job.billing_email || job.customer_email || '';
  const dueLabel = { not_sent: 'Not sent', sent: 'Sent', paid: 'Paid' }[job.invoice_status || 'not_sent'];

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={session?.user?.app_metadata?.role === 'admin' ? `/jobs/${id}` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download/Print Document'}
          </button>
          {session?.user?.app_metadata?.role === 'admin' && (
            <button className="btn btn-sm" onClick={() => setModalOpen(true)}>Send to Customer</button>
          )}
        </div>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={LOGO_SRC} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Invoice<span className="doc-num">#{job.job_number}</span></div>
          </div>

          <div className="doc-body">
            <h1 className="doc-title">Invoice</h1>
            <div className="doc-meta">
              <span><b>{job.customer_name || 'Customer name'}</b></span>
              <span>{job.project_address || 'Project address'}</span>
              <span>Date: <b>{fmtDate(job.invoiced_at ? job.invoiced_at.slice(0, 10) : new Date().toISOString().slice(0, 10))}</b></span>
              <span>Status: <b>{dueLabel}</b></span>
            </div>

            <div className="price-box">
              <span className="price-label">Amount Due</span>
              <span className="price-amount">{fmtMoney(job.invoice_amount)}</span>
            </div>

            {milestones.length > 0 && (
              <div className="section">
                <h3>Payment schedule</h3>
                <table className="milestone-table">
                  <thead><tr><th>Milestone</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {milestones.map((m, i) => <tr key={i}><td>{m.desc}</td><td className="amt">{m.amount}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}

            <div className="section">
              <h3>Bill to</h3>
              <p>{job.customer_name}</p>
              <p>{job.billing_address}</p>
              {recipientEmail && <p>{recipientEmail}</p>}
            </div>

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Invoice #{job.job_number}</span>
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Invoice #${job.job_number}`}
        docType="invoice"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Invoice-${job.job_number}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={markInvoiceSent}
      />

      <style jsx global>{`
        body { background: #dbd8bf; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 700px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px; display: flex; align-items: center; gap: 16px; border-bottom: 5px solid #dbd8bf; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9b773d; text-align: right; }
        .doc-num { display: block; font-weight: 500; font-size: 10.5px; letter-spacing: 0.05em; color: #6b6350; text-transform: none; margin-top: 3px; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9b773d; margin: 0 0 18px; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 30px; border-bottom: 1px solid #ded7c0; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .section { margin-bottom: 22px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #dbd8bf; }
        .section p { font-size: 13px; line-height: 1.6; color: #221f16; margin: 0; }
        .milestone-table { width: 100%; border-collapse: collapse; font-size: 12px; break-inside: avoid; }
        .milestone-table th { text-align: left; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b6350; font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid #ded7c0; }
        .milestone-table td { padding: 7px 0; border-bottom: 1px solid #f0ece0; color: #221f16; }
        .milestone-table td.amt { text-align: right; white-space: nowrap; padding-left: 12px; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }
        @media print { .continued-note { display: block; } .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
