'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { STAGE_LABELS } from '../../../lib/constants';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import PasswordPromptModal from '../../../components/PasswordPromptModal';
import PortalFeed from '../../../components/PortalFeed';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
export default function CustomerHomePage() {
  const { session, loading } = usePortalAuth();
  const { jobs, jobsLoaded, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
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
    // Was previously fire-and-forget with no error handling at all — if
    // has_job_portal_access() denies the call for any reason (e.g. testing
    // with a contact whose "Portal access" checkbox wasn't actually
    // granted — see the Portal Access card fix for why that could look
    // checked in the UI without being true in the database), this failed
    // completely silently and "last viewed" would never update, with
    // nothing in the console to explain why.
    supabase.rpc('mark_portal_viewed', { target_job_id: selectedJobId }).then(({ error }) => {
      if (error) console.error('mark_portal_viewed failed:', error);
    });
  }, [selectedJobId]);

  if (loading || !session) return null;
  // A closed-lost job's portal access is revoked at the RLS layer
  // (migration 070) — once jobs have actually finished loading, zero
  // results means there's genuinely nothing this customer can see right
  // now, not that the page is still fetching.
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  const hasVisit = job && (job.scheduled_start_date || job.scheduled_end_date);

  return (
    <CustomerPortalShell>
      <div className="container" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        <div className="card portal-welcome-card">
          <h3 style={{ marginTop: 0 }}>Welcome to your Project Portal</h3>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            This is your home base for everything happening on your project with McLoud Construction — your next scheduled visit,
            your project details, and every update, estimate, contract, and document we send, all in one place below. New items
            are highlighted at the top of the feed so you never miss one. Use <b>Invoices</b> in the sidebar to pay a bill, and
            <b> Inbox</b> to send us a message directly.
          </p>
        </div>

        {job && (
          <>
            <div className="portal-summary-bar">
              <span className="portal-summary-item"><b>{job.customer_name || '—'}</b></span>
              {job.project_address && <span className="portal-summary-item">{job.project_address}</span>}
              {job.job_type && <span className="portal-summary-item">{job.job_type}</span>}
              <span className="portal-summary-item">Est. completion {fmtDate(job.expected_close_date)}</span>
              <span className={`badge badge-${job.stage} portal-summary-badge`}>{STAGE_LABELS[job.stage]}</span>
            </div>

            <div className="portal-two-col portal-feed-layout">
              <PortalFeed job={job} />

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
            </div>
          </>
        )}
      </div>

      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />

      <style jsx global>{`
        .portal-welcome-card{ background: var(--panel); }
      `}</style>
    </CustomerPortalShell>
  );
}
