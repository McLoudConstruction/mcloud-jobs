'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import SubPortalShell from '../../../../components/SubPortalShell';
import RfpMessageThread from '../../../../components/RfpMessageThread';
import { RFP_RECIPIENT_STATUS_LABELS, projectLabel } from '../../../../lib/constants';

function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SubPortalRfpDetailPage() {
  const router = useRouter();
  const { rfpId: recipientId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [recipient, setRecipient] = useState(null);
  const [photoUrls, setPhotoUrls] = useState([]);

  // Structured proposal fields — replaces the old single free-text box.
  // "Upload Proposal" is the actual bid document; amount/duration/
  // exclusions are real fields staff can scan across bids instead of
  // hunting for them inside a paragraph.
  const [proposalAmount, setProposalAmount] = useState('');
  const [proposalDuration, setProposalDuration] = useState('');
  const [proposalExclusions, setProposalExclusions] = useState('');
  const [proposalNotes, setProposalNotes] = useState('');
  const [files, setFiles] = useState([]); // already-uploaded [{name, storage_path}]
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const load = useCallback(async (email) => {
    const { data: rrData } = await supabase
      .from('rfp_recipients')
      .select('*, companies(id, company_name, contact_email), rfps(*, jobs(job_number, estimate_number, stage, project_address))')
      .eq('id', recipientId)
      .single();
    if (!rrData) return;
    setRecipient(rrData);
    setRole(rrData.companies?.contact_email === email ? 'admin' : 'crew');
    setProposalAmount(rrData.proposal_amount ?? '');
    setProposalDuration(rrData.proposal_duration || '');
    setProposalExclusions(rrData.proposal_exclusions || '');
    setProposalNotes(rrData.proposal_text || '');
    setFiles(Array.isArray(rrData.proposal_files) ? rrData.proposal_files : []);

    if (rrData.status === 'sent') {
      supabase.rpc('mark_rfp_viewed', { target_recipient_id: recipientId }).then(() => {});
    }

    const photoIds = rrData.rfps?.photo_ids || [];
    if (photoIds.length) {
      const { data: photos } = await supabase.from('job_photos').select('*').in('id', photoIds);
      if (photos) {
        const urls = await Promise.all(
          photos.map(async p => {
            const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
            return signed?.signedUrl;
          })
        );
        setPhotoUrls(urls.filter(Boolean));
      }
    }
  }, [recipientId]);

  useEffect(() => {
    if (!session) return;
    load(session.user.email);
    const channel = supabase.channel(`sub-rfp-${recipientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `id=eq.${recipientId}` }, () => load(session.user.email))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, recipientId, load]);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const path = `rfp-proposals/${recipientId}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('subcontractor-docs').upload(path, file);
      if (uploadErr) throw uploadErr;
      setFiles(prev => [...prev, { name: file.name, storage_path: path }]);
    } catch (err) {
      setError(err.message || 'Upload failed — try again.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError('');
    if (files.length === 0 && !String(proposalAmount).trim()) {
      setError('Upload your proposal document or at least enter a bid amount before submitting.');
      return;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc('submit_rfp_proposal', {
      target_recipient_id: recipientId,
      proposal_text_in: proposalNotes.trim() || null,
      proposal_files_in: files,
      proposal_amount_in: proposalAmount === '' ? null : Number(proposalAmount),
      proposal_duration_in: proposalDuration.trim() || null,
      proposal_exclusions_in: proposalExclusions.trim() || null,
    });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
  }

  async function viewFile(f) {
    const { data } = await supabase.storage.from('subcontractor-docs').createSignedUrl(f.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  if (loading || !session || !recipient) return null;

  const rfp = recipient.rfps;
  const resolved = recipient.status === 'awarded' || recipient.status === 'not_awarded';

  return (
    <SubPortalShell company={recipient.companies} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between', display: 'flex' }}>
          <Link href="/sub-portal/rfps" className="btn btn-sm">← Back</Link>
          <span className={`badge badge-${recipient.status}`}>{RFP_RECIPIENT_STATUS_LABELS[recipient.status]}</span>
        </div>

        {/* One card, hairline-divided dash-sections inside — matches
            the GC-side "one structured panel" pattern instead of a
            separate .card per subsection. */}
        <div className="card" style={{ padding: '4px 24px' }}>
          <div className="dash-section" style={{ paddingTop: 18 }}>
            <h3>{rfp?.title}</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
              {projectLabel(rfp?.jobs)}{rfp?.jobs?.project_address}
            </div>
            {rfp?.description && <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{rfp.description}</p>}
          </div>

          {photoUrls.length > 0 && (
            <div className="dash-section">
              <h3>Photos</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                {photoUrls.map((url, i) => (
                  <img key={i} src={url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4 }} />
                ))}
              </div>
            </div>
          )}

          {recipient.status === 'not_awarded' && (
            <div className="dash-section">
              <h3>Not Awarded</h3>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>This request is closed and wasn't awarded to your company. Your submitted proposal is kept below for your records.</p>
            </div>
          )}
          {recipient.status === 'awarded' && (
            <div className="dash-section">
              <h3>Awarded</h3>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>This request was awarded to your company. Look for the Work Order in Work Orders once it's issued.</p>
            </div>
          )}

          {role === 'admin' && (
            <div className="dash-section">
              <h3>{resolved ? 'Your Proposal' : 'Submit Your Proposal'}</h3>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
                Upload your proposal document, then fill in the details below.
              </div>

              <label>Upload Proposal</label>
              {files.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px' }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button className="btn btn-sm" type="button" onClick={() => viewFile(f)}>{f.name}</button>
                      {!resolved && <button className="btn btn-sm btn-danger" type="button" onClick={() => removeFile(i)}>×</button>}
                    </div>
                  ))}
                </div>
              )}
              {!resolved && (
                <label className="btn btn-sm" style={{ display: 'inline-block', cursor: 'pointer', marginBottom: 16 }}>
                  {uploading ? 'Uploading…' : files.length > 0 ? 'Upload Another File' : 'Upload Proposal'}
                  <input type="file" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
                </label>
              )}

              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: files.length > 0 ? 0 : 16 }}>
                <div>
                  <label htmlFor="rfpAmount">Bid Amount</label>
                  <input
                    id="rfpAmount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={proposalAmount}
                    onChange={e => setProposalAmount(e.target.value)}
                    placeholder="$"
                    disabled={resolved}
                  />
                </div>
                <div>
                  <label htmlFor="rfpDuration">Expected Project Duration</label>
                  <input
                    id="rfpDuration"
                    type="text"
                    value={proposalDuration}
                    onChange={e => setProposalDuration(e.target.value)}
                    placeholder="e.g. 3 weeks"
                    disabled={resolved}
                  />
                </div>
              </div>

              <label htmlFor="rfpExclusions" style={{ marginTop: 14 }}>Exclusions / Inclusions</label>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>
                Anything out of the norm you're including or leaving out of this bid.
              </div>
              <textarea
                id="rfpExclusions"
                value={proposalExclusions}
                onChange={e => setProposalExclusions(e.target.value)}
                rows={3}
                placeholder="e.g. Excludes permit fees. Includes dumpster rental."
                disabled={resolved}
              />

              <label htmlFor="rfpNotes" style={{ marginTop: 14 }}>Additional Notes (optional)</label>
              <textarea
                id="rfpNotes"
                value={proposalNotes}
                onChange={e => setProposalNotes(e.target.value)}
                rows={3}
                placeholder="Anything else they should know…"
                disabled={resolved}
              />

              {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

              {!resolved && (
                <>
                  <div className="section-actions">
                    <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>
                      {saving ? 'Submitting…' : recipient.responded_at ? 'Update Proposal' : 'Submit Proposal'}
                    </button>
                  </div>
                  {recipient.responded_at && (
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                      Last submitted {fmtDateTime(recipient.responded_at)} — you can update this until the request is awarded or closed.
                    </div>
                  )}
                </>
              )}

              {resolved && (proposalAmount !== '' || proposalDuration || proposalExclusions || proposalNotes) && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                  Submitted {fmtDateTime(recipient.responded_at)}
                </div>
              )}
            </div>
          )}

          {/* Coded to this specific request — a question asked here shows
              up tagged to this RFP on the staff side, not just dropped
              into the general company thread. */}
          <div className="dash-section">
            <h3>Messages</h3>
            <RfpMessageThread
              recipientId={recipientId}
              companyId={recipient.company_id}
              jobId={rfp?.job_id}
              viewer="sub"
            />
          </div>
        </div>
      </div>
    </SubPortalShell>
  );
}
