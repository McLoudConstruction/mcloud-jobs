'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import { docFilename } from '../../../../../lib/docFilename';
import DocBackLink from '../../../../../components/DocBackLink';
import { generatePdfBase64, downloadPdf } from '../../../../../lib/generatePdf';
import SignaturePad from '../../../../../components/SignaturePad';
import SignatureAuditTrail from '../../../../../components/SignatureAuditTrail';
import { useSettings } from '../../../../../lib/useSettings';
import { useStaffAuth } from '../../../../../lib/staffAuthContext';
import { WAIVER_TYPE_LABELS, WAIVER_STATUS } from '../../../../../lib/lienWaivers';

const LOGO_SRC = '/mcloud-logo.png';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Printable copy of one lien waiver. The wording is the frozen text stored
// when it was requested — this page never re-renders it, so what prints is
// exactly what was signed. Staff sign the owner-facing waiver here; a sub's
// waiver is signed in the Sub Portal.
export default function LienWaiverDocumentPage() {
  const { settings } = useSettings();
  const logoUrl = settings.logo_url || LOGO_SRC;
  const { session, loading } = useDocumentAuth();
  const { fullName: staffFullName } = useStaffAuth();
  const { id, waiverId } = useParams();
  const [job, setJob] = useState(null);
  const [w, setW] = useState(null);
  const [signing, setSigning] = useState(false);
  const [flash, setFlash] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: wData }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('lien_waivers').select('*').eq('id', waiverId).single(),
    ]);
    if (jobData) setJob(jobData);
    if (wData) setW(wData);
  }, [id, waiverId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  async function downloadDocument() {
    setDownloading(true);
    try {
      const filename = docFilename('Lien-Waiver', w.claimant_name || job.customer_name, w.through_date);
      const base64 = await generatePdfBase64('doc-preview', filename);
      downloadPdf(base64, filename);
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function saveOwnerSignature(payload) {
    if (!payload) return;
    setSigning(true);
    const { error } = await supabase.from('lien_waivers').update({ signature: payload }).eq('id', waiverId);
    setSigning(false);
    if (error) { setFlash(`Couldn't save signature: ${error.message}`); setTimeout(() => setFlash(''), 8000); return; }
    setFlash('Signature saved');
    setTimeout(() => setFlash(''), 2500);
    load();
  }

  if (loading || !session || !job || !w) return null;

  const st = WAIVER_STATUS[w.status] || WAIVER_STATUS.requested;
  const toOwner = w.direction === 'to_owner';
  const signerLabel = toOwner ? 'Claimant (McLoud)' : `Claimant (${w.claimant_name || 'Subcontractor'})`;

  return (
    <div>
      <div className="no-print doc-toolbar">
        <DocBackLink fallbackHref={`/jobs/${id}`} className="btn btn-sm" />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download/Print Document'}
          </button>
        </div>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={logoUrl} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Lien Waiver</div>
          </div>
          <div className="doc-body">
            <div className="doc-meta">
              <span>Job #{job.job_number}</span>
              <span>{WAIVER_TYPE_LABELS[w.waiver_type]}</span>
              <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
            </div>
            <pre className="waiver-body">{w.body_text}</pre>

            <div className="section" style={{ marginTop: 26 }}>
              <h3>Signature</h3>
              {flash && <div style={{ fontSize: 11.5, color: '#3a6b45', marginBottom: 8 }}>{flash}</div>}
              {w.status === 'void' && <div style={{ fontSize: 12.5, color: '#a13f3f' }}>This waiver was voided and is not in effect.</div>}
              {w.status === 'waived' && <div style={{ fontSize: 12.5 }}>A signed paper copy was received. {w.notes || ''}</div>}
              {toOwner && w.status !== 'void' && w.status !== 'waived' ? (
                <div className="sig-block">
                  <SignaturePad
                    label={signerLabel}
                    saved={w.signature || undefined}
                    onSave={saveOwnerSignature}
                    saving={signing}
                    defaultName={staffFullName}
                    defaultTitle="Owner, McLoud Contracting, LLC"
                    showTitle
                    locked
                  />
                </div>
              ) : (
                w.signature && (
                  <div className="sig-block">
                    <SignaturePad label={signerLabel} saved={w.signature} locked onSave={() => {}} />
                  </div>
                )
              )}
              {!w.signature && !toOwner && w.status === 'requested' && (
                <div style={{ fontSize: 12.5, color: '#6b6350' }}>Waiting on {w.claimant_name || 'the subcontractor'} to sign in their portal.</div>
              )}
              <SignatureAuditTrail documentType="lien_waiver" documentId={waiverId} isStaff={isAdmin} />
            </div>

            <div className="doc-footer">
              <span>McLoud Construction</span>
              <span>Waiver v{w.template_version || '1'} · generic wording — have counsel review</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        body { background: #EDE7DA; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 700px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px 22px; display: flex; align-items: center; gap: 16px; border-bottom: 4px solid #1C1B19; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9B773D; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 1px solid #ded7c0; }
        .waiver-body { white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.65; color: #1C1B19; margin: 0; }
        .section { margin-bottom: 22px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9B773D; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #9B773D; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 10px; }
        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; }
          .doc-body { padding: 20px 20px 40px; }
          .sig-block { grid-template-columns: 1fr; }
          .doc-logo { width: 130px; }
        }
        @media print { .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } .sig-editing { display: none !important; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
