'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../../../../lib/constants';
import SignaturePad from '../../../../components/SignaturePad';
import SubPortalShell from '../../../../components/SubPortalShell';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SubPortalWorkOrderPage() {
  const router = useRouter();
  const { workOrderId } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [wo, setWo] = useState(null);
  const [job, setJob] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const load = useCallback(async (email) => {
    const { data: woData } = await supabase.from('work_orders').select('*, companies(company_name, contact_email, crew_email)').eq('id', workOrderId).single();
    if (!woData) return;
    setWo(woData);
    setRole(woData.companies?.contact_email === email ? 'admin' : 'crew');
    const { data: jobData } = await supabase.from('sub_visible_jobs').select('*').eq('id', woData.job_id).maybeSingle();
    if (jobData) setJob(jobData);
  }, [workOrderId]);

  useEffect(() => {
    if (!session) return;
    load(session.user.email);
    const channel = supabase.channel(`sub-wo-${workOrderId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `id=eq.${workOrderId}` }, () => load(session.user.email)).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, workOrderId, load]);

  const [draftSignature, setDraftSignature] = useState(null);

  async function submitAcceptance() {
    if (!draftSignature) return;
    if (!confirm('Submit and accept this work order? Once submitted, the signature can no longer be changed.')) return;
    setSaving(true);
    const { error } = await supabase.rpc('accept_work_order', { target_work_order_id: workOrderId, signature_payload: draftSignature });
    setSaving(false);
    if (error) { alert('Failed to sign: ' + error.message); return; }
    router.push(`/sub-portal/projects/${wo.job_id}`);
  }

  async function submitDecline() {
    setSaving(true);
    const { error } = await supabase.rpc('decline_work_order', { target_work_order_id: workOrderId, reason: declineReason || null });
    setSaving(false);
    if (error) { alert('Failed to decline: ' + error.message); return; }
    setDeclining(false);
    setDeclineReason('');
  }

  if (loading || !session || !wo) return null;

  const scopeItems = Array.isArray(wo.included_scope_items) ? wo.included_scope_items : [];

  return (
    <SubPortalShell company={wo.companies} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between', display: 'flex' }}>
          <Link href="/sub-portal/dashboard" className="btn btn-sm">← Back</Link>
          <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
        </div>

        <div className="card">
          <h3>Job Information</h3>
          <div className="portal-info-grid">
            <div>
              <div className="portal-info-label">Address</div>
              <div className="portal-info-value">{job?.project_address || '—'}</div>
            </div>
            <div>
              <div className="portal-info-label">Job Type</div>
              <div className="portal-info-value">{job?.job_type || '—'}</div>
            </div>
            <div>
              <div className="portal-info-label">Stage</div>
              <div className="portal-info-value">{job?.stage || '—'}</div>
            </div>
            <div>
              <div className="portal-info-label">Est. Completion</div>
              <div className="portal-info-value">{fmtDate(job?.expected_close_date)}</div>
            </div>
          </div>
        </div>

        {scopeItems.length > 0 && (
          <div className="card">
            <h3>Scope of Work</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {scopeItems.map((item, i) => (
                <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, paddingLeft: 20, position: 'relative', marginBottom: 7 }}>
                  <span style={{ position: 'absolute', left: 0, color: 'var(--gold)' }}>—</span>{item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {wo.description && (
          <div className="card">
            <h3>Additional Details</h3>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{wo.description}</p>
          </div>
        )}

        {role === 'admin' && (
          <div className="card">
            <h3>Amount</h3>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(wo.amount)}</div>
          </div>
        )}

        {role === 'admin' && wo.status === 'issued' && !declining && (
          <div className="card">
            <h3>Accept This Work Order</h3>
            <SignaturePad
              label="Signature"
              saved={draftSignature}
              saving={saving}
              onSave={setDraftSignature}
              note="Sign to accept this work order"
              showTitle
              requireName
              requireTitle
            />
            {draftSignature?.signature && (
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary btn-sm" onClick={submitAcceptance} disabled={saving}>
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                  You can still clear and re-sign above until you click Submit.
                </div>
              </div>
            )}
            <div className="section-actions">
              <button className="btn btn-sm btn-danger" onClick={() => setDeclining(true)}>Decline Work Order</button>
            </div>
          </div>
        )}

        {role === 'admin' && declining && (
          <div className="card">
            <h3>Decline This Work Order</h3>
            <label>Reason (optional)</label>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} placeholder="Let them know why, if you'd like…" />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={submitDecline} disabled={saving}>{saving ? 'Sending…' : 'Confirm decline'}</button>
              <button className="btn btn-sm" onClick={() => setDeclining(false)}>Cancel</button>
            </div>
          </div>
        )}

        {wo.status === 'accepted' && wo.sub_signature && (
          <div className="card">
            <h3>Signed</h3>
            <div style={{ height: 70, borderBottom: '1.5px solid #221f16', display: 'flex', alignItems: 'flex-end', paddingBottom: 4, marginBottom: 6 }}>
              <img src={wo.sub_signature.signature} alt="Signature" style={{ maxHeight: 64, maxWidth: '100%' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {wo.sub_signature.name || 'Signed'} — {fmtDate(wo.sub_signature.date)}
            </div>
          </div>
        )}

        {role === 'admin' && (wo.status === 'accepted' || wo.status === 'completed') && (
          <InvoiceUploadCard wo={wo} />
        )}

        {wo.status === 'declined' && (
          <div className="card">
            <h3>Declined</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{wo.decline_reason || 'No reason given.'}</p>
          </div>
        )}
      </div>
    </SubPortalShell>
  );
}

function InvoiceUploadCard({ wo }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [viewUrl, setViewUrl] = useState('');

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const path = `invoices/${wo.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('subcontractor-docs').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { error: rpcErr } = await supabase.rpc('upload_sub_invoice', {
        target_work_order_id: wo.id,
        storage_path: path,
        invoice_filename: file.name,
      });
      if (rpcErr) throw rpcErr;
    } catch (err) {
      setError(err.message || 'Upload failed — try again.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function viewInvoice() {
    if (!wo.sub_invoice_storage_path) return;
    const { data, error: urlErr } = await supabase.storage.from('subcontractor-docs').createSignedUrl(wo.sub_invoice_storage_path, 300);
    if (!urlErr && data) { setViewUrl(data.signedUrl); window.open(data.signedUrl, '_blank'); }
  }

  return (
    <div className="card">
      <h3>Your Invoice</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Upload your invoice for this work order so McLoud Construction can see it.
      </div>

      {wo.sub_invoice_filename && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{wo.sub_invoice_filename}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Uploaded {new Date(wo.sub_invoice_uploaded_at).toLocaleDateString('en-US')}</div>
          </div>
          <button className="btn btn-sm" onClick={viewInvoice}>View</button>
        </div>
      )}

      <label className="btn btn-sm" style={{ display: 'inline-block', cursor: 'pointer' }}>
        {uploading ? 'Uploading…' : (wo.sub_invoice_filename ? 'Upload a Replacement' : 'Upload Invoice')}
        <input type="file" accept="application/pdf,image/*" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
      </label>
      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
