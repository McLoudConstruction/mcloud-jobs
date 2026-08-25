'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../../lib/generatePdf';

const LOGO_SRC = '/mcloud-logo.png';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

export default function WorkOrderDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id, workOrderId } = useParams();
  const [job, setJob] = useState(null);
  const [wo, setWo] = useState(null);
  const [company, setCompany] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [showSend, setShowSend] = useState(false);

  const load = useCallback(async () => {
    const { data: woData } = await supabase.from('work_orders').select('*').eq('id', workOrderId).single();
    if (woData) {
      setWo(woData);
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', id).single();
      if (jobData) setJob(jobData);
      if (woData.company_id) {
        const { data: companyData } = await supabase.from('companies').select('*').eq('id', woData.company_id).single();
        if (companyData) {
          setCompany(companyData);
          setSendEmail(prev => prev || companyData.contact_email || '');
        }
      }
    }
  }, [id, workOrderId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Work-Order-${job.job_number}-${wo.id.slice(0, 8)}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function sendToSubcontractor() {
    if (!sendEmail.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const attachmentBase64 = await generatePdfBase64('doc-preview', `Work-Order-${job.job_number}-${wo.id.slice(0, 8)}.pdf`);
      const subject = `Work Order — McLoud Construction, Job #${job.job_number}`;
      const html = `<div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #221f16; line-height: 1.6;">
        <p>Hi${company?.contact_name ? ' ' + company.contact_name.split(' ')[0] : ''},</p>
        <p>Attached is a work order from McLoud Construction for job #${job.job_number} (${job.project_address || ''}).</p>
        <p>Please reach out with any questions.</p>
        <p>Kind Regards,<br>Stachys — McLoud Construction</p>
      </div>`;
      const text = `Attached is a work order from McLoud Construction for job #${job.job_number} (${job.project_address || ''}). Please reach out with any questions.\n\nKind Regards,\nStachys — McLoud Construction`;

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: sendEmail, subject, html, text,
          attachmentBase64, attachmentFilename: `Work-Order-${job.job_number}.pdf`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setSendResult({ ok: true, message: `Sent to ${sendEmail}.` });
      await supabase.from('work_orders').update({ sent_at: new Date().toISOString() }).eq('id', workOrderId);
    } catch (err) {
      setSendResult({ ok: false, message: err.message });
    } finally {
      setSending(false);
    }
  }

  if (loading || !session || !job || !wo) return null;

  const scopeItems = Array.isArray(wo.included_scope_items) ? wo.included_scope_items : [];

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={`/jobs/${id}?tab=Financials`} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download/Print Document'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowSend(s => !s)}>Email to Subcontractor</button>
        </div>
      </div>

      {showSend && (
        <div className="no-print" style={{ padding: '14px 24px', background: '#faf6ec', borderBottom: '1px solid #c4c1a6', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ maxWidth: 280 }} type="email" placeholder="subcontractor@email.com" value={sendEmail} onChange={e => setSendEmail(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={sendToSubcontractor} disabled={sending || !sendEmail.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
          {sendResult && (
            <span style={{ fontSize: 12.5, color: sendResult.ok ? '#3a6b45' : '#a13f3f' }}>{sendResult.message}</span>
          )}
        </div>
      )}

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={LOGO_SRC} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Work Order</div>
          </div>
          <div className="doc-body">
            <h1 className="doc-title">Subcontractor Work Order</h1>
            <div className="doc-meta">
              <span><b>{company?.company_name || 'Subcontractor not selected'}</b></span>
              <span>{job.project_address || 'Project address'}</span>
              <span>Date: <b>{fmtDate(wo.issued_at || wo.created_at)}</b></span>
              <span>Job #{job.job_number}</span>
            </div>

            {scopeItems.length > 0 && (
              <div className="section">
                <h3>Scope of work</h3>
                <ul className="doc-list">
                  {scopeItems.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}

            {wo.description && (
              <div className="section clause">
                <h3>Additional details</h3>
                <p>{wo.description}</p>
              </div>
            )}

            <div className="price-box">
              <span className="price-label">Work Order Amount</span>
              <span className="price-amount">{fmtMoney(wo.amount)}</span>
            </div>

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Work Order — Job #{job.job_number}</span>
            </div>
          </div>
        </div>
      </div>

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
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #dbd8bf; break-after: avoid; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #221f16; margin: 0; white-space: pre-wrap; }
        .doc-list { list-style: none; margin: 0; padding: 0; }
        .doc-list li { font-size: 13.5px; line-height: 1.6; color: #221f16; padding-left: 20px; position: relative; margin-bottom: 7px; break-inside: avoid; }
        .doc-list li::before { content: '—'; position: absolute; left: 0; color: #9b773d; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; flex-wrap: wrap; }
          .doc-body { padding: 20px 20px 40px; }
          .doc-logo { width: 130px; }
        }
        @media print { .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
