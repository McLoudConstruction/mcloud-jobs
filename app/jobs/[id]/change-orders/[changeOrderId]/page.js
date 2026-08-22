'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../../lib/generatePdf';
import SignaturePad from '../../../../../components/SignaturePad';

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

export default function ChangeOrderDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id, changeOrderId } = useParams();
  const [job, setJob] = useState(null);
  const [co, setCo] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signFlash, setSignFlash] = useState('');

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: coData }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('change_orders').select('*').eq('id', changeOrderId).single(),
    ]);
    if (jobData) setJob(jobData);
    if (coData) setCo(coData);
  }, [id, changeOrderId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  const [downloading, setDownloading] = useState(false);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Change-Order-${job.job_number}-${co.co_date}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function saveSignature(role, payload) {
    const sigs = co.co_signatures || {};
    const updated = { ...sigs, [role]: payload };
    setSigning(true);
    const { error } = await supabase.from('change_orders').update({ co_signatures: updated }).eq('id', changeOrderId);
    setSigning(false);
    if (!error) {
      setSignFlash('Signature saved');
      setTimeout(() => setSignFlash(''), 2500);
      load();
    }
  }

  if (loading || !session || !job || !co) return null;

  const recipientEmail = job.billing_email || job.customer_email || '';

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
            <div className="doc-brand-tag">Change Order</div>
          </div>
          <div className="doc-body">
            <h1 className="doc-title">Change Order</h1>
            <div className="doc-meta">
              <span><b>{job.customer_name || 'Customer name'}</b></span>
              <span>{job.project_address || 'Project address'}</span>
              <span>Date: <b>{fmtDate(co.co_date)}</b></span>
              <span>Job #{job.job_number}</span>
            </div>

            <div className="section">
              <h3>Description of change</h3>
              <p>{co.description || '—'}</p>
            </div>

            <div className="price-box">
              <span className="price-label">Change Order Amount</span>
              <span className="price-amount">{fmtMoney(co.amount)}</span>
            </div>

            <div className="section clause">
              <p style={{ fontSize: 11.5, color: '#6b6350' }}>
                This change order modifies the original scope of work and contract price. Signature or written approval confirms acceptance of the additional cost and any related schedule impact.
              </p>
            </div>

            <div className="section">
              <h3>Signatures</h3>
              {signFlash && <div style={{ fontSize: 11.5, color: '#3a6b45', marginBottom: 8 }}>{signFlash}</div>}
              <div className="sig-block">
                <SignaturePad
                  label="Contractor"
                  saved={(co.co_signatures || {}).contractor}
                  onSave={(payload) => saveSignature('contractor', payload)}
                  saving={signing}
                  defaultName="Stachys"
                  defaultTitle="Owner, McLoud Construction"
                />
                <SignaturePad
                  label="Owner"
                  saved={(co.co_signatures || {}).owner}
                  onSave={(payload) => saveSignature('owner', payload)}
                  saving={signing}
                  defaultName={job.customer_contact || ''}
                  defaultTitle=""
                  note="Customer signs here (touch or mouse)"
                />
              </div>
            </div>

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Change Order — Job #{job.job_number}</span>
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel="Change Order"
        docType="change order"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Change-Order-${job.job_number}-${co.co_date}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          await supabase.from('change_orders').update({ sent_at: new Date().toISOString() }).eq('id', changeOrderId);
        }}
      />

      <style jsx global>{`
        body { background: #dbd8bf; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 700px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px; display: flex; align-items: center; gap: 16px; border-bottom: 5px solid #dbd8bf; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9b773d; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9b773d; margin: 0 0 18px; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 30px; border-bottom: 1px solid #ded7c0; }
        .section { margin-bottom: 22px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #dbd8bf; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #221f16; margin: 0; white-space: pre-wrap; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 10px; }
        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; flex-wrap: wrap; }
          .doc-body { padding: 20px 20px 40px; }
          .sig-block { grid-template-columns: 1fr; gap: 20px; }
          .doc-logo { width: 130px; }
        }
        @media print { .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } .sig-editing { display: none !important; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
