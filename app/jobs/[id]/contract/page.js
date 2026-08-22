'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../components/SendDocModal';
import { assignNextJobNumber } from '../../../../lib/assignJobNumber';
import SignaturePad from '../../../../components/SignaturePad';
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

export default function ContractDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const loadJob = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (data) setJob(data);
  }, [id]);

  useEffect(() => { if (session) loadJob(); }, [session, loadJob]);

  const [downloading, setDownloading] = useState(false);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Contract-${job.job_number}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session || !job) return null;

  const scope = job.scope_items || [];
  const milestones = job.milestones || [];
  const extraTerms = (job.additional_terms || []).filter(t => t.text && t.text.trim());
  const sigs = job.contract_signatures || {};
  const recipientEmail = job.billing_email || job.customer_email || '';

  async function saveSignature(role, payload) {
    const updatedSigs = { ...sigs, [role]: payload };
    setSaving(true);
    const { error } = await supabase.from('jobs').update({ contract_signatures: updatedSigs }).eq('id', id);
    setSaving(false);
    if (!error) {
      setFlash('Signature saved — click Submit below to finalize');
      setTimeout(() => setFlash(''), 3000);
      loadJob();
    }
  }

  async function submitContract() {
    if (!sigs.owner?.signature) return;
    if (!confirm('Submit this contract? Once submitted, the signature can no longer be changed.')) return;

    const preSignatureStages = ['new', 'inspected', 'proposal_delivered'];
    const advancing = preSignatureStages.includes(job.stage);
    const patch = { contract_finalized_at: new Date().toISOString() };

    if (advancing) {
      try {
        patch.job_number = await assignNextJobNumber();
        patch.stage = 'approved';
        patch.approved_at = new Date().toISOString();
      } catch (err) {
        setFlash(`Signature saved, but couldn't assign a Job Number: ${err.message}. Try Submit again, or use Advance Stage on the job page.`);
        setTimeout(() => setFlash(''), 8000);
        return; // signature itself already saved above — just don't advance the stage without a real number
      }
    }

    setSaving(true);
    const { error } = await supabase.from('jobs').update(patch).eq('id', id);
    if (!error) {
      await supabase.from('notifications').insert({
        message: `Job ${patch.job_number ? '#' + patch.job_number : '#' + job.estimate_number} (${job.customer_name || 'customer'}) contract was submitted${advancing ? ' and auto-advanced to Approved' : ''}.`,
        job_id: job.id,
      });
    }
    setSaving(false);
    if (!error) {
      setFlash('Contract submitted and finalized');
      setTimeout(() => setFlash(''), 3000);
      loadJob();
    }
  }

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={session?.user?.app_metadata?.role === 'admin' ? `/jobs/${id}` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {flash && <span style={{ fontSize: 12, color: '#3a6b45' }}>{flash}</span>}
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
            <div className="doc-brand-tag">Commercial Contract<span className="doc-num">#{job.job_number}</span></div>
          </div>

          <div className="doc-body">
            <h1 className="doc-title">Commercial Construction Contract</h1>

            <div className="party-grid">
              <div>
                <h4>Contractor</h4>
                <p>McLoud Construction</p>
              </div>
              <div>
                <h4>Owner</h4>
                <p>{job.customer_name || 'Owner / client name'}</p>
                <p className="dim">{job.customer_contact || '—'}</p>
                <p className="dim">{job.billing_address || '—'}</p>
              </div>
            </div>

            <div className="section">
              <h3>Project</h3>
              <p style={{ marginBottom: 4 }}><b>Jobsite:</b> {job.project_address || '—'}</p>
              <p style={{ marginBottom: 12 }}><b>Contract date:</b> {fmtDate(new Date().toISOString().slice(0, 10))}</p>
              <p className={job.description ? '' : 'empty'}>{job.description || 'No description entered yet.'}</p>
            </div>

            <div className="section">
              <h3>Scope of work</h3>
              {scope.length === 0
                ? <ul className="doc-list"><li className="empty">No scope items added yet.</li></ul>
                : <ul className="doc-list">{scope.map((s, i) => <li key={i}>{s.text}</li>)}</ul>}
            </div>

            <div className="group-heading">
              <h2>Terms &amp; Conditions</h2>
              <p>The following provisions apply to this contract and are not part of the job-specific scope or project details above.</p>
            </div>

            {extraTerms.length > 0 && (
              <div className="section">
                <h3>Additional terms</h3>
                <ul className="doc-list">{extraTerms.map((t, i) => <li key={i}>{t.text}</li>)}</ul>
              </div>
            )}

            <div className="section clause">
              <h3>Scope of work and additional work</h3>
              <p>McLoud Construction agrees to perform the Work referenced on page 1. Owner agrees that any supplements or additions to Work ("Additional Work") may be accomplished verbally or with a written change order. The Additional Work includes betterment, owner selected changes, and/or enforcement of code or requirements by municipality or building department ("Code Upgrade Work"). McLoud Construction is specifically authorized, and Owner agrees to pay for, all Code Upgrade Work as well as other Additional Work. The foregoing notwithstanding, McLoud Construction shall NOT be required to perform Code Upgrade or Additional Work without satisfactory payment arrangements.</p>
            </div>

            <div className="section clause">
              <h3>Change orders</h3>
              <p>Any change to the scope of work, contract price, or project schedule must be documented in a written change order signed by both parties before the additional work begins. Verbal authorizations are not binding.</p>
            </div>

            <div className="section clause">
              <h3>Concealed &amp; unforeseen conditions</h3>
              <p>The contract price is based on visible conditions and information available at the time of this agreement. If concealed or unforeseen conditions are discovered once work begins, Contractor will notify Owner promptly and the parties will address the additional cost and schedule impact through a written change order.</p>
            </div>

            <div className="section clause">
              <h3>Insurance &amp; indemnification</h3>
              <p>Contractor will maintain commercial general liability insurance and workers' compensation coverage as required by law, and will provide certificates of insurance upon request. Each party agrees to indemnify and hold the other harmless from claims arising from its own negligent acts or omissions, to the extent permitted by applicable law.</p>
            </div>

            <div className="section clause">
              <h3>Warranty</h3>
              <p>Contractor warrants its workmanship to be free from defects for one (1) year from the date of substantial completion. This warranty does not cover normal wear, misuse, lack of maintenance, or work performed by others.</p>
            </div>

            <div className="section clause">
              <h3>Limitation of liability</h3>
              <p>Contractor's total liability arising out of this contract will not exceed the total contract price. Neither party is liable for indirect, incidental, or consequential damages.</p>
            </div>

            <div className="section clause">
              <h3>Mechanic's lien notice</h3>
              <p>Under {job.governing_state || 'Missouri'} law, contractors, subcontractors, and material suppliers who furnish labor or materials for this project may have lien rights against the property if not paid in full.</p>
            </div>

            <div className="section clause">
              <h3>Dispute resolution</h3>
              <p>The parties agree to first attempt to resolve any dispute through good-faith negotiation, then mediation before litigation. This contract is governed by the laws of the State of {job.governing_state || 'Missouri'}.</p>
            </div>

            <div className="section clause">
              <h3>Termination</h3>
              <p>Either party may terminate this contract for material breach not cured within fourteen (14) days of written notice. Owner will pay for all work completed and materials procured through the date of termination.</p>
            </div>

            <div className="section">
              <h3>Contract price</h3>
              <div className="price-box">
                <span className="price-label">Total Contract Price</span>
                <span className="price-amount">{fmtMoney(job.contract_price)}</span>
              </div>
              {milestones.length > 0 && (
                <table className="milestone-table">
                  <thead><tr><th>Payment milestone</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {milestones.map((m, i) => <tr key={i}><td>{m.desc}</td><td className="amt">{m.amount}</td></tr>)}
                  </tbody>
                </table>
              )}
            </div>

            <div className="section">
              <h3>Signature</h3>
              {job.contract_finalized_at && (
                <div style={{ fontSize: 11.5, color: '#3a6b45', marginBottom: 10 }}>
                  This document was submitted and finalized on {fmtDate(job.contract_finalized_at.slice(0, 10))}. It can no longer be edited.
                </div>
              )}
              <div className="sig-block" style={{ gridTemplateColumns: '1fr', maxWidth: 340 }}>
                <SignaturePad
                  label="Customer"
                  saved={sigs.owner}
                  onSave={(payload) => saveSignature('owner', payload)}
                  saving={saving}
                  defaultName={job.customer_contact || job.customer_name || ''}
                  defaultTitle=""
                  showTitle={job.project_type === 'commercial'}
                  note="Customer signs here (touch or mouse)"
                  locked={Boolean(job.contract_finalized_at)}
                />
              </div>

              {!job.contract_finalized_at && sigs.owner?.signature && (
                <div className="no-print" style={{ marginTop: 14 }}>
                  <button className="btn btn-primary btn-sm" onClick={submitContract} disabled={saving}>
                    {saving ? 'Submitting…' : 'Submit'}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                    You can still clear and re-sign above until you click Submit — after that, this document is locked.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Contract #${job.job_number}`}
        docType="contract"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Contract-${job.job_number}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          await supabase.from('jobs').update({ contract_sent_at: new Date().toISOString() }).eq('id', id);
        }}
      />

      <style jsx global>{`
        body { background: #dbd8bf; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 1000px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px; display: flex; align-items: center; gap: 16px; border-bottom: 5px solid #dbd8bf; }
        .doc-logo { width: 170px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9b773d; text-align: right; }
        .doc-num { display: block; font-weight: 500; font-size: 10.5px; letter-spacing: 0.05em; color: #6b6350; text-transform: none; margin-top: 3px; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 22px; color: #9b773d; margin: 0 0 18px; }
        .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-bottom: 20px; margin-bottom: 26px; border-bottom: 1px solid #ded7c0; }
        .party-grid h4 { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #9b773d; margin: 0 0 6px; }
        .party-grid p { font-size: 12.5px; line-height: 1.55; color: #221f16; margin: 0; }
        .party-grid p.dim { color: #6b6350; }
        .section { margin-bottom: 24px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 10px; padding-left: 11px; border-left: 3px solid #dbd8bf; break-after: avoid; }
        .section p { font-size: 12.5px; line-height: 1.65; color: #221f16; margin: 0 0 6px; }
        .section p.empty { color: #a8a29a; font-style: italic; }
        .doc-list { margin: 0; padding-left: 0; list-style: none; }
        .doc-list li { font-size: 12.5px; line-height: 1.6; color: #221f16; padding-left: 20px; position: relative; margin-bottom: 7px; break-inside: avoid; }
        .doc-list li::before { content: "—"; position: absolute; left: 0; color: #dbd8bf; }
        .doc-list li.empty { color: #a8a29a; font-style: italic; }
        .group-heading { margin: 32px 0 18px; padding-top: 20px; border-top: 2px solid #49402a; break-after: avoid; }
        .group-heading h2 { font-weight: 700; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: #49402a; margin: 0 0 4px; }
        .group-heading p { font-size: 11px; color: #6b6350; font-style: italic; margin: 0; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9b773d; }
        .price-amount { font-weight: 700; font-size: 19px; color: #221f16; }
        .milestone-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .milestone-table th { text-align: left; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b6350; font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid #ded7c0; }
        .milestone-table td { padding: 7px 0; border-bottom: 1px solid #f0ece0; color: #221f16; }
        .milestone-table td.amt { text-align: right; white-space: nowrap; padding-left: 12px; }
        .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 10px; }
        .party-grid { break-inside: avoid; }
        .milestone-table { break-inside: avoid; }
        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; flex-wrap: wrap; }
          .doc-body { padding: 20px 20px 40px; }
          .party-grid { grid-template-columns: 1fr; }
          .sig-block { grid-template-columns: 1fr; gap: 20px; }
          .doc-logo { width: 130px; }
        }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }
        @media print { .continued-note { display: block; } .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } .sig-editing { display: none !important; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
