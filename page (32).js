'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { STAGE_LABELS } from '../../../lib/constants';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import PasswordPromptModal from '../../../components/PasswordPromptModal';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
export default function CustomerHomePage() {
  const { session, loading } = usePortalAuth();
  const { jobs, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [updates, setUpdates] = useState([]);
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

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

  // First-time welcome blurb — shown once per customer, dismissible, so it
  // doesn't keep taking up space for returning visitors.
  useEffect(() => {
    if (!session) return;
    const dismissKey = `mcloud-portal-welcome-dismissed-${session.user.id}`;
    setWelcomeOpen(!window.localStorage.getItem(dismissKey));
  }, [session]);

  function dismissWelcome() {
    setWelcomeOpen(false);
    if (session) window.localStorage.setItem(`mcloud-portal-welcome-dismissed-${session.user.id}`, '1');
  }

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('job_updates').select('*').eq('job_id', selectedJobId).not('sent_at', 'is', null).order('update_date', { ascending: false }).limit(3).then(({ data }) => { if (data) setUpdates(data); });
    load();
    supabase.rpc('mark_portal_viewed', { target_job_id: selectedJobId });
    const channel = supabase.channel(`portal-home-updates-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  if (loading || !session) return null;

  const hasVisit = job && (job.scheduled_start_date || job.scheduled_end_date);

  return (
    <CustomerPortalShell>
      <div className="container" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {welcomeOpen && (
          <div className="card portal-welcome-card">
            <button className="portal-welcome-close" onClick={dismissWelcome} aria-label="Dismiss">×</button>
            <h3 style={{ marginTop: 0 }}>Welcome to your Project Portal</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
              This is your home base for everything happening on your project with McLoud Construction — your next scheduled visit,
              the latest progress updates, and your project details, all in one place. Head to <b>Documents</b> in the sidebar any
              time to view or sign your estimate and contract, respond to a material selection, or catch up on past updates, and use
              <b> Inbox</b> to send us a message directly.
            </p>
          </div>
        )}

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
                <h3>Next Scheduled Visit</h3>
                {hasVisit ? (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--heading)' }}>
                      {fmtDate(job.scheduled_start_date)}
                      {job.scheduled_end_date && job.scheduled_end_date !== job.scheduled_start_date && (
                        <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--ink-soft)' }}> – {fmtDate(job.scheduled_end_date)}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>We'll be on site for this project.</div>
                  </div>
                ) : (
                  <div className="empty-state">Nothing on the calendar yet — we'll post a date here once your visit is scheduled.</div>
                )}
              </div>

              <div className="card">
                <h3>Recent Updates</h3>
                {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
                {updates.map(u => (
                  <div className="update-entry" key={u.id}>
                    <div className="update-date">{fmtDate(u.update_date)}</div>
                    <div className="section-actions">
                      <a href={`/jobs/${job.id}/updates/${u.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm">View Progress Update ↗</a>
                    </div>
                  </div>
                ))}
                <div className="section-actions" style={{ marginTop: updates.length ? 10 : 0 }}>
                  <a href="/customerportal/documents" className="btn btn-sm">See All Documents &amp; Updates →</a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />

      <style jsx global>{`
        .portal-welcome-card{ position: relative; background: var(--panel); }
        .portal-welcome-close{
          position: absolute; top: 10px; right: 12px; background: none; border: none; cursor: pointer;
          font-size: 20px; line-height: 1; color: var(--ink-soft); padding: 4px;
        }
        .portal-welcome-close:hover{ color: var(--heading); }
      `}</style>
    </CustomerPortalShell>
  );
}
