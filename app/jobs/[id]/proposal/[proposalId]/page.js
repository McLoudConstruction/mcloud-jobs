'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../../lib/generatePdf';
import { projectNumber } from '../../../../../lib/constants';
import ProposalDocument from '../../../../../components/ProposalDocument';

// Same document as /jobs/[id]/proposal, but for one specific saved
// proposal instead of whichever one is currently Selected on the job —
// this is what a per-proposal shareable link points at, so two draft
// options can be sent out and compared before either is picked.
export default function IndividualProposalDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id, proposalId } = useParams();
  const [job, setJob] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: proposalData, error: proposalErr }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('proposals').select('*').eq('id', proposalId).eq('job_id', id).maybeSingle(),
    ]);
    if (jobData) setJob(jobData);
    if (proposalData) setProposal(proposalData);
    else if (!proposalErr || proposalErr.code !== 'PGRST116') setNotFound(true);
  }, [id, proposalId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  // Marks this specific proposal (not any other saved version) as viewed,
  // only for the customer session — never when an admin previews it.
  useEffect(() => {
    if (session?.user?.app_metadata?.role !== 'admin' && proposalId) {
      supabase.rpc('mark_proposal_doc_viewed', { target_proposal_id: proposalId });
    }
  }, [session, proposalId]);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Estimate-${projectNumber(job)}-${proposal.name}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session) return null;
  if (notFound) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>This proposal couldn't be found.</div>;
  if (!job || !proposal) return null;

  const isAdmin = session?.user?.app_metadata?.role === 'admin';
  const recipientEmail = job.billing_email || job.customer_email || '';
  const isSelected = job.selected_proposal_id === proposal.id;

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={isAdmin ? `/jobs/${id}?tab=Estimate&section=proposals` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && isSelected && <span className="badge" style={{ marginRight: 4, background: '#3a6b45' }}>Selected</span>}
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download/Print Document'}
          </button>
          {isAdmin && (
            <button className="btn btn-sm" onClick={() => setModalOpen(true)}>{justSent ? '✓ Sent' : 'Send to Customer'}</button>
          )}
        </div>
      </div>

      <ProposalDocument
        docTag={`#${projectNumber(job)} — ${proposal.name}`}
        footerLabel={`Estimate #${projectNumber(job)} — ${proposal.name}`}
        customerName={job.customer_name}
        customerContact={job.customer_contact}
        projectAddress={job.project_address}
        description={job.description}
        price={proposal.contract_price}
        scope={proposal.scope_items || []}
        terms={(proposal.additional_terms || []).filter(t => t.text && t.text.trim())}
      />

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel={`Estimate #${projectNumber(job)} — ${proposal.name}`}
        docType="proposal"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Estimate-${projectNumber(job)}-${proposal.name}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          const sentAt = new Date().toISOString();
          const { error } = await supabase.from('proposals').update({ sent_at: sentAt }).eq('id', proposal.id);
          setProposal(prev => prev ? { ...prev, sent_at: sentAt } : prev);
          setJustSent(true);
          if (error) alert("The email sent, but recording it as sent didn't save: " + error.message + ". If you reload this page, it may look unsent — that's just this tracking flag, not the email itself.");
        }}
      />
    </div>
  );
}
