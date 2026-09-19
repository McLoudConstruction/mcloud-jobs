'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useSubPortalData } from '../../../../lib/useSubPortalData';
import SubPortalShell from '../../../../components/SubPortalShell';
import RfpMessageThread from '../../../../components/RfpMessageThread';
import PhotoLightbox from '../../../../components/PhotoLightbox';
import { RFP_RECIPIENT_STATUS_LABELS, projectNumber, projectNumberLabel, customerLastName } from '../../../../lib/constants';

function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SubPortalRfpDetailPage() {
  const router = useRouter();
  const { rfpId: recipientId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recipient, setRecipient] = useState(null); // row from sub_visible_rfps
  const [photoUrls, setPhotoUrls] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [messagesOpen, setMessagesOpen] = useState(false);

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

  // Company/role come from the same shared hook every other sub-portal
  // page uses, instead of this page re-deriving them from its own
  // companies(...) embed — one fewer place that logic can drift.
  const { company, role } = useSubPortalData(session);

  // sub_visible_rfps has job fields already flattened in — see migration
  // 117 for why the old rfp_recipients(*, rfps(*, jobs(...))) embed came
  // back with every job field blank (jobs has no RLS policy for subs).
  const load = useCallback(async () => {
    const { data: rrData } = await supabase
      .from('sub_visible_rfps')
      .select('*')
      .eq('id', recipientId)
      .maybeSingle();
    if (!rrData) return;
    setRecipient(rrData);
    setProposalAmount(rrData.proposal_amount ?? '');
    setProposalDuration(rrData.proposal_duration || '');
    setProposalExclusions(rrData.proposal_exclusions || '');
    setProposalNotes(rrData.proposal_text || '');
    setFiles(Array.isArray(rrData.proposal_files) ? rrData.proposal_files : []);

    if (rrData.status === 'sent') {
      supabase.rpc('mark_rfp_viewed', { target_recipient_id: recipientId }).then(() => {});
    }

    const photoIds = rrData.photo_ids || [];
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
    load();
    const channel = supabase.channel(`sub-rfp-${recipientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `id=eq.${recipientId}` }, load)
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

  const resolved = recipient.status === 'awarded' || recipient.status === 'not_awarded';
  const num = projectNumber(recipient);
  const numLabel = projectNumberLabel(recipient);

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <Link href="/sub-portal/rfps" className="btn btn-sm">← Back</Link>
        </div>

        {/* Flat header, not another card — the job a sub needs to
            identify at a glance (who, what number, where) sits up top
            instead of buried in a description line. */}
        <div className="rfp-detail-header">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: '0 0 10px', color: 'var(--heading)', fontSize: 19 }}>{recipient.title}</h2>
            <div className="portal-info-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div>
                <div className="portal-info-label">Customer</div>
                <div className="portal-info-value">{customerLastName(recipient) || '—'}</div>
              </div>
              <div>
                <div className="portal-info-label">{numLabel} #</div>
                <div className="portal-info-value">{num}</div>
              </div>
              <div>
                <div className="portal-info-label">Address</div>
                <div className="portal-info-value">{recipient.project_address || '—'}</div>
              </div>
            </div>
          </div>
          <span className={`badge badge-${recipient.status}`} style={{ flexShrink: 0 }}>{RFP_RECIPIENT_STATUS_LABELS[recipient.status]}</span>
        </div>

        <div className="rfp-detail-layout">
          <div className="rfp-detail-main">
            {recipient.description && (
              <div className="dash-section">
                <h3>Description</h3>
                <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', margin: 0 }}>{recipient.description}</p>
              </div>
            )}

            {photoUrls.length > 0 && (
              <div className="dash-section">
                <h3>Photos</h3>
                <div className="photo-thumb-grid">
                  {photoUrls.map((url, i) => (
                    <button key={i} type="button" className="photo-thumb-btn" onClick={() => setLightboxIndex(i)} aria-label={`Expand photo ${i + 1}`}>
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recipient.status === 'not_awarded' && (
              <div className="dash-section">
                <h3>Not Awarded</h3>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>This request is closed and wasn't awarded to your company. Your submitted proposal is kept below for your records.</p>
              </div>
            )}
            {recipient.status === 'awarded' && (
              <div className="dash-section">
                <h3>Awarded</h3>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>This request was awarded to your company. Look for the Work Order in Work Orders once it's issued.</p>
              </div>
            )}

            {/* Gated behind a button rather than always showing the
                thread inline — most RFPs never need a back-and-forth,
                so this keeps the page short until someone actually has
                a question. Coded to this specific request either way. */}
            <div className="dash-section">
              {!messagesOpen ? (
                <button type="button" className="btn btn-sm" onClick={() => setMessagesOpen(true)}>
                  Have a question about this request? Send us a Message
                </button>
              ) : (
                <>
                  <h3>Messages</h3>
                  <RfpMessageThread
                    recipientId={recipientId}
                    companyId={recipient.company_id}
                    jobId={recipient.job_id}
                    viewer="sub"
                  />
                </>
              )}
            </div>
          </div>

          {role === 'admin' && (
            <div className="rfp-detail-sidebar">
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

                <label htmlFor="rfpDuration">Expected Project Duration</label>
                <input
                  id="rfpDuration"
                  type="text"
                  value={proposalDuration}
                  onChange={e => setProposalDuration(e.target.value)}
                  placeholder="e.g. 3 weeks"
                  disabled={resolved}
                />

                <label htmlFor="rfpExclusions">Exclusions / Inclusions</label>
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

                <label htmlFor="rfpNotes">Additional Notes (optional)</label>
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
            </div>
          )}
        </div>
      </div>

      <PhotoLightbox
        photos={photoUrls}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
      />
    </SubPortalShell>
  );
}
