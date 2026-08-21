'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../../../../lib/constants';
import SignaturePad from '../../../../components/SignaturePad';

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
    const { data: woData } = await supabase.from('work_orders').select('*, companies(contact_email, crew_email)').eq('id', workOrderId).single();
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

  async function acceptWorkOrder(signature) {
    setSaving(true);
    const { error } = await supabase.rpc('accept_work_order', { target_work_order_id: workOrderId, signature_payload: signature });
    setSaving(false);
    if (error) alert('Failed to sign: ' + error.message);
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
    <div className="portal-textured" style={{ minHeight: '100vh' }}>
      <div style={{ background: 'var(--header-bg)', borderBottom: '1px solid var(--header-line)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/sub-portal/dashboard" className="btn btn-sm" style={{ color: 'var(--header-text)', borderColor: 'var(--header-line)' }}>← Back</Link>
        <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
      </div>

      <div className="container" style={{ paddingTop: 24, maxWidth: 640 }}>
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
              saved={null}
              saving={saving}
              onSave={acceptWorkOrder}
              note="Sign to accept this work order"
            />
            <div className="section-actions">
              <button className="btn btn-sm btn-danger" onClick={() => setDeclining(true)}>Can't take this one</button>
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

        {wo.status === 'declined' && (
          <div className="card">
            <h3>Declined</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{wo.decline_reason || 'No reason given.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
