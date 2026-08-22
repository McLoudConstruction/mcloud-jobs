'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../lib/generatePdf';
import { contractPathFor } from '../../../../lib/constants';

const LOGO_SRC = '/mcloud-logo.png';

const STANDARD_EXCLUSIONS = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Estimate valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (moisture, structural, electrical, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Homeowner is responsible for clearing the work area and relocating pets prior to each scheduled work day.',
  'Material selections not specified in the scope of work are estimated using a standard allowance and may affect final pricing.',
];

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

export default function ProposalDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadJob = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (data) setJob(data);
  }, [id]);

  useEffect(() => { if (session) loadJob(); }, [session, loadJob]);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Estimate-${job.job_number}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session || !job) return null;

  const scope = job.scope_items || [];
  const extraTerms = (job.additional_terms || []).filter(t => t.text && t.text.trim());
  const allTerms = extraTerms.length ? extraTerms : STANDARD_EXCLUSIONS.map(text => ({ text, standard: true }));
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
          {!job.contract_finalized_at && (
            <Link href={contractPathFor(job)} className="btn btn-primary btn-sm">Sign the Contract →</Link>
          )}
        </div>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={LOGO_SRC} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Estimate<span className="doc-num">#{job.job_number}</span></div>
          </div>

          <div className="doc-body">
            <h1 className="doc-title">Project Estimate</h1>

            <div className="party-grid">
              <div>
                <h4>Contractor</h4>
                <p>McLoud Construction</p>
              </div>
              <div>
                <h4>Customer</h4>
                <p>{job.customer_name || 'Customer name'}</p>
                <p className="dim">{job.customer_contact || '—'}</p>
              </div>
            </div>

            <div className="section">
              <h3>Project</h3>
              <p style={{ marginBottom: 4 }}><b>Jobsite:</b> {job.project_address || '—'}</p>
              <p style={{ marginBottom: 12 }}><b>Estimate date:</b> {fmtDate(new Date().toISOString().slice(0, 10))}</p>
              <p className={job.description ? '' : 'empty'}>{job.description || 'No description entered yet.'}</p>
            </div>

            <div className="price-box">
              <span className="price-label">Total Investment</span>
              <span className="price-amount">{fmtMoney(job.contract_price)}</span>
            </div>

            <div className="section">
              <h3>Scope of work</h3>
              {scope.length === 0 ? (
                <ul className="doc-list"><li className="empty">No scope items added yet.</li></ul>
              ) : (
                <ul className="doc-list">{scope.map((s, i) => <li key={i}>{s.text}</li>)}</ul>
              )}
            </div>

            <div className="section">
              <h3>Assumptions &amp; exclusions</h3>
              <ul className="doc-list">{allTerms.map((t, i) => <li key={i}>{t.text}</li>)}</ul>
            </div>

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Estimate #{job.job_number}</span>
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Estimate #${job.job_number}`}
        docType="proposal"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Estimate-${job.job_number}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          await supabase.from('jobs').update({ proposal_sent_at: new Date().toISOString() }).eq('id', id);
        }}
      />

      <style jsx global>{`
        body { background: #dbd8bf; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 1000px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px; display: flex; align-items: center; gap: 16px; border-bottom: 5px solid #dbd8bf; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9b773d; text-align: right; }
        .doc-num { display: block; font-weight: 500; font-size: 10.5px; letter-spacing: 0.05em; color: #6b6350; text-transform: none; margin-top: 3px; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9b773d; margin: 0 0 18px; }
        .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-bottom: 20px; margin-bottom: 10px; border-bottom: 1px solid #ded7c0; break-inside: avoid; }
        .party-grid h4 { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #9b773d; margin: 0 0 6px; }
        .party-grid p { font-size: 12.5px; line-height: 1.55; color: #221f16; margin: 0; }
        .party-grid p.dim { color: #6b6350; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 34px; border-bottom: 1px solid #ded7c0; }
        .section { margin-bottom: 24px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 10px; padding-left: 11px; border-left: 3px solid #dbd8bf; break-after: avoid; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #221f16; margin: 0; }
        .section p.empty { color: #a8a29a; font-style: italic; }
        .doc-list { margin: 0; padding-left: 0; list-style: none; }
        .doc-list li { font-size: 13.5px; line-height: 1.6; color: #221f16; padding-left: 20px; position: relative; margin-bottom: 7px; break-inside: avoid; }
        .doc-list li::before { content: "—"; position: absolute; left: 0; color: #dbd8bf; }
        .doc-list li.empty { color: #a8a29a; font-style: italic; }
        .doc-list li.empty::before { content: ""; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .proposal-cta {
          display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
          background: #8a3d14; color: #fff; text-decoration: none;
          border-radius: 8px; padding: 18px 22px; margin-bottom: 28px;
        }
        .proposal-cta:hover { background: #6e3010; }
        .proposal-cta-text { font-size: 14px; font-weight: 500; opacity: 0.9; }
        .proposal-cta-action { font-size: 16px; font-weight: 700; }
        @media (max-width: 500px) { .proposal-cta { flex-direction: column; align-items: flex-start; } }

        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }

        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; flex-wrap: wrap; }
          .doc-body { padding: 20px 20px 40px; }
          .party-grid { grid-template-columns: 1fr; }
          .doc-logo { width: 130px; }
        }

        @media print {
          .continued-note { display: block; }
          .no-print { display: none !important; }
          body { background: #fff; }
          .doc-outer { padding: 0; }
          .doc-page { box-shadow: none; max-width: none; }
        }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
