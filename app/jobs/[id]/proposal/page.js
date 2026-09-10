'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../lib/generatePdf';
import { contractPathFor, projectNumber } from '../../../../lib/constants';
import ProposalDocument from '../../../../components/ProposalDocument';

const STANDARD_EXCLUSIONS = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Estimate valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (moisture, structural, electrical, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Homeowner is responsible for clearing the work area and relocating pets prior to each scheduled work day.',
  'Material selections not specified in the scope of work are estimated using a standard allowance and may affect final pricing.',
];

export default function ProposalDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [justSent, setJustSent] = useState(false); // locks the Send button to "Sent" for this page visit
  const [downloading, setDownloading] = useState(false);

  const loadJob = useCallback(async () => {
    const [{ data }, { data: financials }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('job_financials').select('contract_price, invoice_amount, invoice_status').eq('job_id', id).maybeSingle(),
    ]);
    if (data) setJob({ ...data, ...financials });
  }, [id]);

  useEffect(() => { if (session) loadJob(); }, [session, loadJob]);

  // Marks this specific estimate as viewed (not just the portal home page) —
  // only for the customer session, never when an admin previews the doc.
  useEffect(() => {
    if (session?.user?.app_metadata?.role !== 'admin' && id) {
      supabase.rpc('mark_proposal_viewed', { target_job_id: id });
    }
  }, [session, id]);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Estimate-${projectNumber(job)}.pdf`);
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
            <button className="btn btn-sm" onClick={() => setModalOpen(true)}>{justSent ? '✓ Sent' : 'Send to Customer'}</button>
          )}
          {!job.contract_finalized_at && (
            <Link href={contractPathFor(job)} className="btn btn-primary btn-sm">Sign the Contract →</Link>
          )}
        </div>
      </div>

      <ProposalDocument
        docTag={`#${projectNumber(job)}`}
        footerLabel={`Estimate #${projectNumber(job)}`}
        customerName={job.customer_name}
        customerContact={job.customer_contact}
        projectAddress={job.project_address}
        description={job.description}
        price={job.contract_price}
        scope={scope}
        terms={allTerms}
      />

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Estimate #${projectNumber(job)}`}
        docType="proposal"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Estimate-${projectNumber(job)}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          const sentAt = new Date().toISOString();
          const { error } = await supabase.from('jobs').update({ proposal_sent_at: sentAt }).eq('id', id);
          setJob(prev => prev ? { ...prev, proposal_sent_at: sentAt } : prev);
          setJustSent(true);
          if (error) alert("The email sent, but recording it as sent didn't save: " + error.message + ". If you reload this page, it may look unsent — that's just this tracking flag, not the email itself.");
        }}
      />
    </div>
  );
}
