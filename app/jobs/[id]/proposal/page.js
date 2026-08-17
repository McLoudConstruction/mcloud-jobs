'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useRequireAuth } from '../../../../lib/useAuth';
import SendDocModal from '../../../../components/SendDocModal';

const LOGO_SRC = '/mcloud-logo.png';

const STANDARD_EXCLUSIONS = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Proposal valid for 30 days from the date above.',
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
  const { session, loading } = useRequireAuth();
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadJob = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (data) setJob(data);
  }, [id]);

  useEffect(() => { if (session) loadJob(); }, [session, loadJob]);

  function printDocument() {
    const PAGE_HEIGHT_PX = 979;
    const preview = document.getElementById('doc-preview');
    const header = preview.querySelector('.doc-header');
    const body = preview.querySelector('.doc-body');
    if (header && body) {
      const blocks = [header, ...Array.from(body.children)];
      let runningHeight = 0;
      blocks.forEach((el, i) => {
        if (i === 0) { runningHeight = el.offsetHeight; return; }
        const cs = window.getComputedStyle(el);
        const h = el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
        if (runningHeight + h > PAGE_HEIGHT_PX) {
          const note = document.createElement('div');
          note.className = 'continued-note print-injected';
          note.textContent = '— continued on next page —';
          el.parentNode.insertBefore(note, el);
          el.classList.add('print-injected');
          el.style.pageBreakBefore = 'always';
          el.style.breakBefore = 'page';
          runningHeight = h;
        } else {
          runningHeight += h;
        }
      });
    }
    window.print();
    window.addEventListener('afterprint', clearPagination, { once: true });
    setTimeout(clearPagination, 3000);
  }

  function clearPagination() {
    document.querySelectorAll('.continued-note.print-injected').forEach(el => el.remove());
    document.querySelectorAll('.print-injected').forEach(el => {
      el.style.pageBreakBefore = '';
      el.style.breakBefore = '';
      el.classList.remove('print-injected');
    });
  }

  if (loading || !session || !job) return null;

  const scope = job.scope_items || [];
  const extraTerms = (job.additional_terms || []).filter(t => t.text && t.text.trim());
  const allTerms = extraTerms.length ? extraTerms : STANDARD_EXCLUSIONS.map(text => ({ text, standard: true }));
  const recipientEmail = job.billing_email || job.customer_email || '';

  return (
    <div>
      <div className="no-print" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#d3d0b5', borderBottom: '1px solid #c4c1a6' }}>
        <Link href={`/jobs/${id}`} className="btn btn-sm">← Back to job</Link>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>Generate PDF</button>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={LOGO_SRC} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Proposal<span className="doc-num">#{job.job_number}</span></div>
          </div>

          <div className="doc-body">
            <h1 className="doc-title">Project Proposal</h1>
            <div className="doc-meta">
              <span><b>{job.customer_name || 'Customer name'}</b></span>
              <span>{job.project_address || 'Project address'}</span>
              <span>Date: <b>{fmtDate(new Date().toISOString().slice(0, 10))}</b></span>
            </div>

            <div className="section">
              <h3>Overview</h3>
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
              <span>Proposal #{job.job_number}</span>
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Proposal #${job.job_number}`}
        docType="proposal"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        pdfFilename={`Proposal-${job.job_number}.pdf`}
        defaultEmail={recipientEmail}
        onPrint={printDocument}
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
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 34px; border-bottom: 1px solid #ded7c0; }
        .section { margin-bottom: 24px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 10px; padding-left: 11px; border-left: 3px solid #dbd8bf; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #221f16; margin: 0; }
        .section p.empty { color: #a8a29a; font-style: italic; }
        .doc-list { margin: 0; padding-left: 0; list-style: none; }
        .doc-list li { font-size: 13.5px; line-height: 1.6; color: #221f16; padding-left: 20px; position: relative; margin-bottom: 7px; }
        .doc-list li::before { content: "—"; position: absolute; left: 0; color: #dbd8bf; }
        .doc-list li.empty { color: #a8a29a; font-style: italic; }
        .doc-list li.empty::before { content: ""; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }

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
