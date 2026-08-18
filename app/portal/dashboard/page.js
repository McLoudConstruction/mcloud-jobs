'use client';
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useSettings } from '../../../lib/useSettings';
import { STAGE_LABELS, phaseForStage } from '../../../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtMoney(v) {
  if (!v) return '—';
  return '$' + Number(v).toLocaleString('en-US');
}

export default function PortalDashboardPage() {
  const { session, loading } = usePortalAuth();
  const { settings } = useSettings();
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');

  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [passwordPromptDismissed, setPasswordPromptDismissed] = useState(false);

  useEffect(() => {
    if (session && !passwordPromptDismissed) {
      const t = setTimeout(() => setPasswordPromptOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [session, passwordPromptDismissed]);

  function dismissPasswordPrompt() {
    setPasswordPromptOpen(false);
    setPasswordPromptDismissed(true);
  }

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .not('portal_invited_at', 'is', null)
      .order('created_at', { ascending: false });
    if (data) {
      setJobs(data);
      setSelectedJobId(prev => prev || (data[0] && data[0].id));
    }
  }, []);

  useEffect(() => { if (session) loadJobs(); }, [session, loadJobs]);

  const loadJobDetails = useCallback(async () => {
    if (!selectedJobId) return;
    const [{ data: u }, { data: q }] = await Promise.all([
      supabase.from('job_updates').select('*').eq('job_id', selectedJobId).order('update_date', { ascending: false }),
      supabase.from('job_questions').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: false }),
    ]);
    if (u) setUpdates(u);
    if (q) setQuestions(q);
  }, [selectedJobId]);

  useEffect(() => {
    if (!session || !selectedJobId) return;
    loadJobDetails();

    const channel = supabase
      .channel(`portal-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${selectedJobId}` }, loadJobDetails)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions', filter: `job_id=eq.${selectedJobId}` }, loadJobDetails)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${selectedJobId}` }, loadJobs)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session, selectedJobId, loadJobDetails, loadJobs]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/portal';
  }

  async function submitQuestion(e) {
    e.preventDefault();
    if (!question.trim() || !selectedJobId) return;
    setSending(true);
    const { error } = await supabase.from('job_questions').insert({
      job_id: selectedJobId,
      customer_email: session.user.email,
      message: question,
    });
    setSending(false);
    if (!error) {
      setQuestion('');
      setFlash('Question sent — we\'ll get back to you soon.');
      setTimeout(() => setFlash(''), 3000);
    }
  }

  if (loading || !session) return null;

  const job = jobs.find(j => j.id === selectedJobId);

  return (
    <div>
      <div className="topbar">
        {settings.logo_url
          ? <img src={settings.logo_url} alt="Logo" style={{ height: 32, width: 'auto' }} />
          : <div className="brand">McLoud <span>Portal</span></div>}
        <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
      </div>

      <div className="container">
        {jobs.length === 0 && (
          <div className="empty-state">No projects are linked to this email yet. If you're expecting to see one, reach out to McLoud Construction.</div>
        )}

        {jobs.length > 1 && (
          <div className="stage-tabs">
            {jobs.map(j => (
              <button key={j.id} className={`stage-tab ${j.id === selectedJobId ? 'active' : ''}`} onClick={() => setSelectedJobId(j.id)}>
                #{j.job_number}
              </button>
            ))}
          </div>
        )}

        {job && (
          <>
            {/* Section 1 — full width */}
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
              <span className={`badge badge-${job.stage}`} style={{ marginTop: 12, display: 'inline-block' }}>{STAGE_LABELS[job.stage]}</span>
            </div>

            {/* Sections 2 & 3 — side by side */}
            <div className="portal-two-col">
              <div className="card">
                <h3>Documents</h3>
                <div className="section-actions" style={{ marginTop: 0, flexDirection: 'column', alignItems: 'flex-start' }}>
                  {phaseForStage(job.stage) === 'opportunity' && (
                    <>
                      <a href={`/jobs/${job.id}/proposal`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Proposal ↗</a>
                      <a href={`/jobs/${job.id}/contract`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                    </>
                  )}
                  {phaseForStage(job.stage) !== 'opportunity' && (
                    <>
                      <a href={`/jobs/${job.id}/contract`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                      {phaseForStage(job.stage) === 'completed_phase' && job.invoice_amount && (
                        <a href={`/jobs/${job.id}/invoice`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Invoice ↗</a>
                      )}
                    </>
                  )}
                </div>

                {phaseForStage(job.stage) === 'completed_phase' && job.invoice_amount && (
                  <div style={{ background: '#faf6ec', border: '1px solid var(--line)', borderRadius: 6, padding: '14px 16px', marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>Invoice Amount</span>
                      <span style={{ fontWeight: 700, fontSize: 17 }}>{fmtMoney(job.invoice_amount)}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 0 }}>
                      Status: {job.invoice_status === 'paid' ? 'Paid — thank you!' : job.invoice_status === 'sent' ? 'Sent, payment due' : 'Not yet sent'}
                    </p>
                  </div>
                )}
              </div>

              <div className="card">
                <h3>Progress Updates</h3>
                {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
                {updates.map(u => (
                  <div className="update-entry" key={u.id}>
                    <div className="update-date">{fmtDate(u.update_date)}</div>
                    {u.work_completed && <><div className="update-field-label">Work completed</div><p>{u.work_completed}</p></>}
                    {u.upcoming_work && <><div className="update-field-label">Upcoming work</div><p>{u.upcoming_work}</p></>}
                    {u.issues_notes && <><div className="update-field-label">Notes</div><p>{u.issues_notes}</p></>}
                    <div className="section-actions">
                      <a href={`/jobs/${job.id}/updates/${u.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 4 — full width */}
            <div className="card">
              <h3>Have a question about your project?</h3>
              <form onSubmit={submitQuestion}>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Fill out your question here" />
                {flash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 8 }}>{flash}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Submit question'}</button>
                </div>
              </form>

              {questions.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  {questions.map(q => (
                    <div className="update-entry" key={q.id}>
                      <div className="update-date">{fmtDate((q.created_at || '').slice(0, 10))}</div>
                      <p>{q.message}</p>
                      {q.response && <><div className="update-field-label">McLoud Construction replied</div><p>{q.response}</p></>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />
    </div>
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
  background: '#fff', borderRadius: 8, padding: 26, width: '100%', maxWidth: 420,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
};
