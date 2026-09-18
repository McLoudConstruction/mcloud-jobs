'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import SubPortalShell from '../../../../components/SubPortalShell';
import { RFP_RECIPIENT_STATUS_LABELS } from '../../../../lib/constants';

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

  const [proposalText, setProposalText] = useState('');
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
      .select('*, companies(id, company_name, contact_email), rfps(*, jobs(job_number, project_address))')
      .eq('id', recipientId)
      .single();
    if (!rrData) return;
    setRecipient(rrData);
    setRole(rrData.companies?.contact_email === email ? 'admin' : 'crew');
    setProposalText(rrData.proposal_text || '');
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
    if (!proposalText.trim() && files.length === 0) { setError('Add a note or a file before submitting.'); return; }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc('submit_rfp_proposal', {
      target_recipient_id: recipientId,
      proposal_text_in: proposalText.trim() || null,
      proposal_files_in: files,
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

        <div className="card">
          <h3>{rfp?.title}</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
            {rfp?.jobs?.project_address}
          </div>
          {rfp?.description && <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{rfp.description}</p>}
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

        {recipient.status === 'not_awarded' && (
          <div className="card">
            <h3>Not Awarded</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>This request is closed and wasn't awarded to your company. Your submitted proposal is kept below for your records.</p>
          </div>
        )}
        {recipient.status === 'awarded' && (
          <div className="card">
            <h3>Awarded</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>This request was awarded to your company. Look for the Work Order in Work Orders once it's issued.</p>
          </div>
        )}

        {role === 'admin' && (
          <div className="card">
            <h3>{resolved ? 'Your Proposal' : 'Submit Your Proposal'}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
              A couple of sentences and a number is fine, or attach a full write-up — whatever fits the job.
            </div>
            <textarea
              value={proposalText}
              onChange={e => setProposalText(e.target.value)}
              rows={4}
              placeholder="Your bid, timeline, anything they should know…"
              disabled={resolved}
            />

            {files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => viewFile(f)}>{f.name}</button>
                    {!resolved && <button className="btn btn-sm btn-danger" onClick={() => removeFile(i)}>×</button>}
                  </div>
                ))}
              </div>
            )}

            {!resolved && (
              <>
                <label className="btn btn-sm" style={{ display: 'inline-block', cursor: 'pointer', marginTop: 8 }}>
                  {uploading ? 'Uploading…' : 'Attach a file'}
                  <input type="file" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
                </label>

                {error && <div className="error-text">{error}</div>}

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
          </div>
        )}
      </div>
    </SubPortalShell>
  );
}
