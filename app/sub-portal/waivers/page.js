'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { subPortalJobHeading } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';
import SignaturePad from '../../../components/SignaturePad';
import { WAIVER_TYPE_LABELS, WAIVER_STATUS } from '../../../lib/lienWaivers';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SubPortalWaiversPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [waivers, setWaivers] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, jobsById, ready } = useSubPortalData(session);

  const load = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase.from('lien_waivers').select('*').eq('company_id', company.id).eq('direction', 'from_sub').order('created_at', { ascending: false });
    setWaivers(data || []);
  }, [company]);

  useEffect(() => {
    if (!company) return undefined;
    load();
    const channel = supabase.channel(`sub-waivers-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lien_waivers', filter: `company_id=eq.${company.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, load]);

  function open(w) {
    setOpenId(openId === w.id ? null : w.id);
    setConfirmAmount('');
    setError('');
    setNotice('');
    setDisputing(false);
    setDisputeNote('');
  }

  async function sign(w, payload) {
    if (!payload) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('sign_lien_waiver', {
      target_waiver_id: w.id,
      signature_payload: payload,
      confirmed_amount: Number(String(confirmAmount).replace(/[^0-9.]/g, '')),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNotice('Signed — thank you. A copy stays on this page.');
    setOpenId(null);
    load();
  }

  async function dispute(w) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('dispute_lien_waiver', { target_waiver_id: w.id, note_in: disputeNote });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNotice('Sent to the office. They will reissue a corrected waiver.');
    setOpenId(null);
    setDisputing(false);
    setDisputeNote('');
    load();
  }

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  const pending = waivers.filter(w => w.status === 'requested');
  const history = waivers.filter(w => w.status !== 'requested');
  const canSign = role === 'admin';

  function Row({ w, actionable }) {
    const job = jobsById[w.job_id];
    const st = WAIVER_STATUS[w.status] || WAIVER_STATUS.requested;
    const isOpen = openId === w.id;
    const amountOk = Number(String(confirmAmount).replace(/[^0-9.]/g, '')) === Number(w.payment_amount);
    return (
      <div style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }} onClick={() => open(w)}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{WAIVER_TYPE_LABELS[w.waiver_type]}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
              {job ? subPortalJobHeading(job) : 'Job details unavailable'} · through {fmtDate(w.through_date)}
              {w.due_date && w.status === 'requested' ? ` · please sign by ${fmtDate(w.due_date)}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(w.payment_amount)}</div>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg }}>{st.label}</span>
          </div>
        </div>

        {isOpen && (
          <div style={{ marginTop: 12 }}>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.6, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, margin: 0 }}>{w.body_text}</pre>

            {w.status === 'rejected' && w.reject_reason && (
              <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>You told us: {w.reject_reason}</div>
            )}

            {w.status === 'signed' && w.signature?.signature && (
              <div style={{ marginTop: 12 }}>
                <SignaturePad label="Your signature" saved={w.signature} locked onSave={() => {}} />
              </div>
            )}

            {actionable && canSign && (
              <div style={{ marginTop: 14 }}>
                {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  To confirm, type the amount above ({fmtMoney(w.payment_amount)})
                </label>
                <input value={confirmAmount} onChange={e => setConfirmAmount(e.target.value)} placeholder="0.00" inputMode="decimal" style={{ maxWidth: 200, marginBottom: 12 }} />
                {amountOk ? (
                  <SignaturePad
                    label="Sign this waiver"
                    onSave={payload => sign(w, payload)}
                    saving={busy}
                    defaultName=""
                    showTitle
                    requireTitle
                    titlePlaceholder="Your title (e.g. Owner)"
                    note="Sign with your finger or mouse"
                  />
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>The signature box appears once the amount matches.</div>
                )}

                <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  {!disputing ? (
                    <button type="button" className="btn btn-sm" onClick={() => setDisputing(true)}>Something is wrong with this waiver</button>
                  ) : (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>What needs to change?</label>
                      <textarea rows={3} value={disputeNote} onChange={e => setDisputeNote(e.target.value)} placeholder="e.g. Amount should be $4,200 — the change order isn't included." />
                      <div className="section-actions">
                        <button type="button" className="btn btn-sm btn-primary" disabled={busy || !disputeNote.trim()} onClick={() => dispute(w)}>{busy ? 'Sending…' : 'Send to the office'}</button>
                        <button type="button" className="btn btn-sm" onClick={() => setDisputing(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {actionable && !canSign && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>Only your company&apos;s admin login can sign lien waivers.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section" style={{ paddingTop: 20 }}>
          <h3>Lien waivers</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
            A lien waiver is a short document confirming payment for your work. Please read each one and only sign if the amount and dates are right.
          </div>
          {notice && <div style={{ fontSize: 12.5, color: '#3a6b45', marginBottom: 10 }}>{notice}</div>}

          <h4 style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9b773d', margin: '16px 0 4px' }}>Needs your signature</h4>
          {pending.length === 0 && <div className="empty-state">Nothing waiting on you.</div>}
          {pending.map(w => <Row key={w.id} w={w} actionable />)}

          {history.length > 0 && (
            <>
              <h4 style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9b773d', margin: '22px 0 4px' }}>History</h4>
              {history.map(w => <Row key={w.id} w={w} />)}
            </>
          )}
        </div>
      </div>
    </SubPortalShell>
  );
}
