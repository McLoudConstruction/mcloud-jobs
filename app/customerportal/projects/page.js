'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { STAGE_LABELS, contractPathFor } from '../../../lib/constants';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CustomerProjectsPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [updates, setUpdates] = useState([]);
  const [selections, setSelections] = useState([]);
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    const dismissKey = `mcloud-portal-password-prompt-dismissed-${session.user.id}`;
    if (window.localStorage.getItem(dismissKey)) return;
    const t = setTimeout(() => setPasswordPromptOpen(true), 400);
    return () => clearTimeout(t);
  }, [session]);

  function dismissPasswordPrompt() {
    setPasswordPromptOpen(false);
    if (session) window.localStorage.setItem(`mcloud-portal-password-prompt-dismissed-${session.user.id}`, '1');
  }

  useEffect(() => {
    if (!selectedJobId) return;
    supabase.from('job_updates').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('update_date', { ascending: false }).then(({ data }) => { if (data) setUpdates(data); });
    supabase.rpc('mark_portal_viewed', { target_job_id: selectedJobId });
    const channel = supabase.channel(`portal-updates-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${selectedJobId}` }, () => {
        supabase.from('job_updates').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('update_date', { ascending: false }).then(({ data }) => { if (data) setUpdates(data); });
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('material_selections').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('created_at', { ascending: false }).then(({ data }) => { if (data) setSelections(data); });
    load();
    const channel = supabase.channel(`portal-selections-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  if (loading || !session) return null;

  return (
    <CustomerPortalShell>
      <div className="container" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <>
            <div className="card">
              <div className="portal-info-grid">
                <div>
                  <div className="portal-info-label">Customer</div>
                  <div className="portal-info-value">{job.customer_name || '—'}</div>
                </div>
                <div>
                  <div className="portal-info-label">Project Address</div>
                  <div className="portal-info-value">{job.project_address || '—'}</div>
                </div>
                <div>
                  <div className="portal-info-label">Job Type</div>
                  <div className="portal-info-value">{job.job_type || '—'}</div>
                </div>
                <div>
                  <div className="portal-info-label">Estimated Completion</div>
                  <div className="portal-info-value">{fmtDate(job.expected_close_date)}</div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginRight: 8 }}>Status:</span>
                <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
              </div>
            </div>

            <div className="portal-two-col">
              <div className="card">
                <h3>Documents</h3>
                <div className="section-actions" style={{ marginTop: 0, flexDirection: 'column', alignItems: 'flex-start' }}>
                  {job.proposal_sent_at && (
                    <a href={`/jobs/${job.id}/proposal`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Estimate ↗</a>
                  )}
                  {job.proposal_sent_at && !job.contract_finalized_at && (
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -4 }}>
                      Ready to move forward? Open the estimate and use the "Sign the Contract" button inside it.
                    </div>
                  )}
                  {job.contract_sent_at && (
                    <a href={contractPathFor(job)} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                  )}
                  {selections.map(s => (
                    <a key={s.id} href={`/jobs/${job.id}/material-selections/${s.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                      {s.status === 'approved' ? '✓ ' : ''}{s.title} {s.status !== 'approved' ? '— Choose Now ↗' : '↗'}
                    </a>
                  ))}
                  {!job.proposal_sent_at && !job.contract_sent_at && (
                    <div className="empty-state" style={{ padding: '4px 0' }}>Nothing has been sent yet.</div>
                  )}
                </div>
              </div>

              <div className="card">
                <h3>Progress Updates</h3>
                {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
                {updates.map(u => (
                  <div className="update-entry" key={u.id}>
                    <div className="update-date">{fmtDate(u.update_date)}</div>
                    <div className="section-actions">
                      <a href={`/jobs/${job.id}/updates/${u.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Progress Update ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />
    </CustomerPortalShell>
  );
}

function PasswordPromptModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  async function setupPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setResult('Password needs to be at least 6 characters.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setResult(error.message);
    } else {
      setResult('Password set! You can now sign in with your email and password anytime.');
      setTimeout(onClose, 1800);
    }
  }

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Want to skip the email link next time?</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
          Set up a password and you can sign in with your email and password anytime — no need to wait on a new link.
        </p>
        <form onSubmit={setupPassword}>
          <label htmlFor="promptPassword">New password</label>
          <input id="promptPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required />
          {result && <div style={{ fontSize: 12.5, color: result.startsWith('Password set') ? '#3a6b45' : '#a13f3f', marginTop: 8 }}>{result}</div>}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Set up password'}</button>
            <button className="btn btn-sm" type="button" onClick={onClose}>Maybe later</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 420,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
};
