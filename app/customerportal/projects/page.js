'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { STAGE_LABELS, STAGE_ORDER, EVENT_TYPE_LABELS } from '../../../lib/constants';
import { pickNextVisit, localISODate } from '../../../lib/nextVisit';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import PasswordPromptModal from '../../../components/PasswordPromptModal';
import PortalFeed from '../../../components/PortalFeed';
import PortalFieldProgress from '../../../components/PortalFieldProgress';
import PortalPhotoFeed from '../../../components/PortalPhotoFeed';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function relativeDay(iso) {
  const today = localISODate();
  if (iso === today) return 'Today';
  const t = new Date(`${today}T12:00:00`);
  t.setDate(t.getDate() + 1);
  return iso === localISODate(t) ? 'Tomorrow' : '';
}
// "Phase: Framing" / "Phases: Framing, Electrical, Plumbing +1 more"
function phaseLine(labels) {
  if (!labels || labels.length === 0) return '';
  const shown = labels.slice(0, 3).join(', ');
  const more = labels.length > 3 ? ` +${labels.length - 3} more` : '';
  return `${labels.length === 1 ? 'Phase' : 'Phases'}: ${shown}${more}`;
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

  // "Next Scheduled Visit": the project start date until it arrives, then
  // whichever comes next: a published schedule phase or an event staff chose
  // to share (see lib/nextVisit.js). undefined = still loading, null = nothing
  // upcoming. If the events lookup fails (e.g. migration 160 not run yet) the
  // card still works from the phases alone.
  const [visit, setVisit] = useState(undefined);
  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;
    setVisit(undefined);
    (async () => {
      const [phaseRes, eventRes] = await Promise.all([
        supabase.from('job_phases').select('label, start_date, end_date, sort_order, allow_weekend_work')
          .eq('job_id', job.id).eq('status', 'published').order('sort_order', { ascending: true }),
        supabase.rpc('customer_job_events', { target_job_id: job.id }),
      ]);
      if (cancelled) return;
      if (phaseRes.error) console.error('Next visit: phases failed:', phaseRes.error);
      if (eventRes.error) console.error('Next visit: shared events failed:', eventRes.error);
      setVisit(pickNextVisit({
        today: localISODate(),
        startDate: job.scheduled_start_date || null,
        endDate: job.scheduled_end_date || null,
        phases: phaseRes.data || [],
        events: eventRes.data || [],
      }));
    })();
    return () => { cancelled = true; };
  }, [job?.id, job?.scheduled_start_date, job?.scheduled_end_date]);

  if (loading || !session) return null;
  // A closed-lost job's portal access is revoked at the RLS layer
  // (migration 070) — once jobs have actually finished loading, zero
  // results means there's genuinely nothing this customer can see right
  // now, not that the page is still fetching.
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  // Est. completion isn't meaningful (or decided) until the project has
  // reached the Scheduled stage or later — hide it before that.
  const showEstCompletion = job && STAGE_ORDER.indexOf(job.stage) >= STAGE_ORDER.indexOf('scheduled');

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <>
            <div className="portal-summary-bar">
              <span className="portal-summary-item"><b>{job.customer_name || '—'}</b></span>
              {job.project_address && <span className="portal-summary-item">{job.project_address}</span>}
              {job.job_type && <span className="portal-summary-item">{job.job_type}</span>}
              {showEstCompletion && <span className="portal-summary-item">Est. completion {fmtDate(job.expected_close_date)}</span>}
              <span className={`badge badge-${job.stage} portal-summary-badge`}>{STAGE_LABELS[job.stage]}</span>
            </div>

            <div className="dash-section" style={{ paddingTop: 0 }}>
              <h3>Next Scheduled Visit</h3>
              {visit === undefined ? null : visit ? (
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--heading)' }}>
                    {fmtDate(visit.date)}
                    {visit.endDate && (
                      <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--ink-soft)' }}> – {fmtDate(visit.endDate)}</span>
                    )}
                    {relativeDay(visit.date) && (
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--gold)' }}> · {relativeDay(visit.date)}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                    {visit.kind === 'event'
                      ? `${EVENT_TYPE_LABELS[visit.eventType] || 'Visit'}${visit.time ? ` at ${fmtTime(visit.time)}` : ''}`
                      : "We'll be on site for this project."}
                  </div>
                  {phaseLine(visit.phaseLabels) && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--heading)', marginTop: 6 }}>{phaseLine(visit.phaseLabels)}</div>
                  )}
                </div>
              ) : (
                <div className="empty-state">Nothing on the calendar yet — we'll post a date here once your next visit is scheduled.</div>
              )}
            </div>

            <PortalFieldProgress jobId={job.id} />

            <PortalPhotoFeed jobId={job.id} />

            <PortalFeed job={job} />
          </>
        )}
      </div>

      <PasswordPromptModal open={passwordPromptOpen} onClose={dismissPasswordPrompt} />
    </CustomerPortalShell>
  );
}
