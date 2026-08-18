'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
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
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordResult, setPasswordResult] = useState('');

  async function setupPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setPasswordResult('Password needs to be at least 6 characters.');
      return;
    }
    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) {
      setPasswordResult(error.message);
    } else {
      setPasswordResult('Password set! You can now sign in with your email and password anytime.');
      setNewPassword('');
      setTimeout(() => { setShowPasswordSetup(false); setPasswordResult(''); }, 3000);
    }
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
        <div className="brand">McLoud <span>Portal</span></div>
        <button className="btn btn-sm" onClick={handleSignOut}>Sign out</button>
      </div>

      <div className="container">
        <div className="card">
          {showPasswordSetup ? (
            <>
              <h3>Set up a password</h3>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>
                Once set, you can sign in with your email and password anytime — no need to wait on a new email link.
              </p>
              <form onSubmit={setupPassword}>
                <label htmlFor="newPassword">New password</label>
                <input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required />
                {passwordResult && <div style={{ fontSize: 12.5, color: passwordResult.startsWith('Password set') ? '#3a6b45' : '#a13f3f', marginTop: 8 }}>{passwordResult}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Save password'}</button>
                  <button className="btn btn-sm" type="button" onClick={() => setShowPasswordSetup(false)}>Cancel</button>
                </div>
              </form>
            </>
          ) : (
            <div className="section-actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Want to skip the email link next time?</span>
              <button className="btn btn-sm" onClick={() => setShowPasswordSetup(true)}>Set up a password</button>
            </div>
          )}
        </div>

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
            <div className="card">
              <h2 style={{ margin: '0 0 8px', color: 'var(--heading)' }}>{job.description || 'Your project'}</h2>
              <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 10 }}>{job.project_address}</p>
            </div>

            {phaseForStage(job.stage) === 'opportunity' && (
              <div className="card">
                <h3>Documents</h3>
                <div className="section-actions" style={{ marginTop: 0 }}>
                  <a href={`/jobs/${job.id}/proposal`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Proposal ↗</a>
                  <a href={`/jobs/${job.id}/contract`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                </div>
              </div>
            )}

            {phaseForStage(job.stage) !== 'opportunity' && (
              <div className="card">
                <h3>Documents</h3>
                <div className="section-actions" style={{ marginTop: 0 }}>
                  <a href={`/jobs/${job.id}/contract`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Contract ↗</a>
                  {phaseForStage(job.stage) === 'completed_phase' && job.invoice_amount && (
                    <a href={`/jobs/${job.id}/invoice`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Invoice ↗</a>
                  )}
                </div>
              </div>
            )}

            {phaseForStage(job.stage) === 'completed_phase' && job.invoice_amount && (
              <div className="card">
                <h3>Invoice</h3>
                <div style={{ background: '#faf6ec', border: '1px solid var(--line)', borderRadius: 6, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>Amount</span>
                  <span style={{ fontWeight: 700, fontSize: 19 }}>{fmtMoney(job.invoice_amount)}</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>
                  Status: {job.invoice_status === 'paid' ? 'Paid — thank you!' : job.invoice_status === 'sent' ? 'Sent, payment due' : 'Not yet sent'}
                </p>
              </div>
            )}

            <div className="card">
              <h3>Project updates</h3>
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

            <div className="card">
              <h3>Ask a question</h3>
              <form onSubmit={submitQuestion}>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Type your question here…" />
                {flash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 8 }}>{flash}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send question'}</button>
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
    </div>
  );
}
