'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRequireAuth } from '../../../../lib/useAuth';
import { supabase } from '../../../../lib/supabaseClient';
import AppShell from '../../../../components/AppShell';
import RfpMessageThread from '../../../../components/RfpMessageThread';
import { RFP_STATUS_LABELS, RFP_RECIPIENT_STATUS_LABELS, projectLabel } from '../../../../lib/constants';

function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RfpDetailPage() {
  const { session, loading } = useRequireAuth();
  const { rfpId } = useParams();
  const [rfp, setRfp] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [closing, setClosing] = useState(false);
  const [acting, setActing] = useState(false);
  const [openMessagesFor, setOpenMessagesFor] = useState(null);

  const load = useCallback(async () => {
    const { data: rfpData } = await supabase.from('rfps').select('*, jobs(job_number, estimate_number, stage, project_address)').eq('id', rfpId).single();
    if (!rfpData) return;
    setRfp(rfpData);

    const { data: recipientData } = await supabase.from('rfp_recipients').select('*, companies(id, company_name, contact_email)').eq('rfp_id', rfpId).order('sent_at', { ascending: true });
    if (recipientData) setRecipients(recipientData);

    if (rfpData.photo_ids?.length) {
      const { data: photos } = await supabase.from('job_photos').select('*').in('id', rfpData.photo_ids);
      if (photos) {
        const urls = await Promise.all(
          photos.map(async p => {
            const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
            return signed?.signedUrl;
          })
        );
        setPhotoUrls(urls.filter(Boolean));
      }
    } else {
      setPhotoUrls([]);
    }
  }, [rfpId]);

  useEffect(() => {
    if (!session) return;
    load();
    const channel = supabase.channel(`rfp-${rfpId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfps', filter: `id=eq.${rfpId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `rfp_id=eq.${rfpId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, rfpId, load]);

  async function handleAward(companyId) {
    if (!confirm('Award this RFP to this subcontractor? Every other recipient will be marked Not Awarded.')) return;
    setActing(true);
    const { error } = await supabase.rpc('award_rfp', { target_rfp_id: rfpId, target_company_id: companyId });
    setActing(false);
    if (error) { alert('Failed to award: ' + error.message); return; }
    // Don't rely solely on the realtime subscription — refresh directly
    // so the award shows up immediately.
    await load();
  }

  async function handleCloseNotAwarded() {
    if (!confirm("Close this RFP as Not Awarded for every recipient? Use this when the project isn't moving forward.")) return;
    setActing(true);
    const { error } = await supabase.rpc('close_rfp_not_awarded', { target_rfp_id: rfpId });
    setActing(false);
    setClosing(false);
    if (error) { alert('Failed to close: ' + error.message); return; }
    // Don't rely solely on the realtime subscription — refresh directly
    // so the closed status shows up immediately.
    await load();
  }

  if (loading || !session || !rfp) return null;

  return (
    <AppShell>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between', display: 'flex' }}>
          <Link href="/subcontractors/rfps" className="btn btn-sm">← Back</Link>
          <span className={`badge badge-${rfp.status}`}>{RFP_STATUS_LABELS[rfp.status]}</span>
        </div>

        <div className="card">
          <h3>{rfp.title}</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
            {projectLabel(rfp.jobs)}{rfp.jobs?.project_address}
          </div>
          {rfp.expected_by && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6 }}>Expected by {fmtDate(rfp.expected_by)}</div>
          )}
          {rfp.description && <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{rfp.description}</p>}
          {rfp.source_folder && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Source: {rfp.source_folder}</div>
          )}
        </div>

        {photoUrls.length > 0 && (
          <div className="card">
            <h3>Photos</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {photoUrls.map((url, i) => (
                <img key={i} src={url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4 }} />
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h3>Recipients</h3>
          {recipients.map(rr => (
            <div key={rr.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{rr.companies?.company_name}</div>
                <span className={`badge badge-${rr.status}`}>{RFP_RECIPIENT_STATUS_LABELS[rr.status]}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                Sent {fmtDateTime(rr.sent_at)}
                {rr.first_viewed_at && ` · Viewed ${fmtDateTime(rr.first_viewed_at)}`}
                {rr.responded_at && ` · Responded ${fmtDateTime(rr.responded_at)}`}
              </div>

              {(fmtMoney(rr.proposal_amount) || rr.proposal_duration) && (
                <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
                  {fmtMoney(rr.proposal_amount) && (
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Bid Amount</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtMoney(rr.proposal_amount)}</div>
                    </div>
                  )}
                  {rr.proposal_duration && (
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Expected Duration</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{rr.proposal_duration}</div>
                    </div>
                  )}
                </div>
              )}
              {rr.proposal_exclusions && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Exclusions / Inclusions</div>
                  <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '2px 0 0' }}>{rr.proposal_exclusions}</p>
                </div>
              )}
              {rr.proposal_text && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Notes</div>
                  <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', margin: '2px 0 0' }}>{rr.proposal_text}</p>
                </div>
              )}
              {Array.isArray(rr.proposal_files) && rr.proposal_files.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {rr.proposal_files.map((f, i) => (
                    <ProposalFileLink key={i} file={f} />
                  ))}
                </div>
              )}

              <div className="section-actions" style={{ marginTop: 8 }}>
                {rfp.status === 'open' && rr.status !== 'awarded' && rr.status !== 'not_awarded' && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleAward(rr.company_id)} disabled={acting}>
                    Award to {rr.companies?.company_name}
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setOpenMessagesFor(id => id === rr.id ? null : rr.id)}>
                  {openMessagesFor === rr.id ? 'Hide Messages' : 'Messages'}
                </button>
              </div>

              {openMessagesFor === rr.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                  <RfpMessageThread recipientId={rr.id} companyId={rr.company_id} jobId={rfp.job_id} viewer="staff" />
                </div>
              )}
            </div>
          ))}
          {recipients.length === 0 && <div className="empty-state">Nobody was sent this RFP.</div>}
        </div>

        {rfp.status === 'awarded' && (
          <div className="card">
            <h3>Awarded</h3>
            <p style={{ fontSize: 13.5 }}>
              This RFP was awarded to {recipients.find(rr => rr.company_id === rfp.awarded_company_id)?.companies?.company_name || 'a subcontractor'} on {fmtDateTime(rfp.awarded_at)}.
              Set up the Work Order for them separately from Subcontractors → Work Orders.
            </p>
          </div>
        )}

        {rfp.status === 'open' && (
          <div className="card">
            <h3>Project not moving forward?</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
              If this project is closed lost and won't be awarded to anyone, close every recipient's RFP as Not Awarded. It stays visible to them, marked closed, rather than disappearing.
            </div>
            {!closing ? (
              <button className="btn btn-sm btn-danger" onClick={() => setClosing(true)}>Close — Not Awarded</button>
            ) : (
              <div className="section-actions">
                <button className="btn btn-primary btn-sm" onClick={handleCloseNotAwarded} disabled={acting}>{acting ? 'Closing…' : 'Confirm close'}</button>
                <button className="btn btn-sm" onClick={() => setClosing(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ProposalFileLink({ file }) {
  async function open() {
    const { data } = await supabase.storage.from('subcontractor-docs').createSignedUrl(file.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }
  return <button className="btn btn-sm" onClick={open}>{file.name || 'Attachment'}</button>;
}
