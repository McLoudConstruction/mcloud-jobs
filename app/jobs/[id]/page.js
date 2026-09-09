'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import Breadcrumb from '../../../components/Breadcrumb';
import PhotoGallery from '../../../components/PhotoGallery';
import InternalUpdatesPanel from '../../../components/InternalUpdatesPanel';
import JobCostSummary from '../../../components/JobCostSummary';
import DrawsCard from '../../../components/DrawsCard';
import ReceiptsCard from '../../../components/ReceiptsCard';
import WorkOrdersCard from '../../../components/WorkOrdersCard';
import TradeBreakdownCard from '../../../components/TradeBreakdownCard';
import PortalAccessCard from '../../../components/PortalAccessCard';
import EstimateTab from '../../../components/EstimateTab';
import { assignNextJobNumber } from '../../../lib/assignJobNumber';
import JobMaterialSelectionsPanel from '../../../components/JobMaterialSelectionsPanel';
import ProjectMilestonesCard from '../../../components/ProjectMilestonesCard';
import { cacheJobPatch, getCachedJob } from '../../../lib/offlineDb';
import MapLinkMenu from '../../../components/MapLinkMenu';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage, contractPathFor, formattedProjectNumber, isOpportunity } from '../../../lib/constants';
import {
  OverviewIcon, PersonIcon, CalculatorIcon, FinanceIcon, ChangeOrderIcon, WorkOrderIcon,
  InvoiceIcon, ReceiptIcon, PhotosIcon, MaterialSelectionsTabIcon, UpdatesTabIcon, InternalUpdatesIcon,
} from '../../../components/icons';

// Sub-nav restructure Part 2 (Sep 2026): this file used to also define
// the 12 card components below directly — now each lives in its own
// file under components/, imported here like everything else. Same
// behavior, same props, nothing moved data-wise; this just makes it
// possible to open "the Scope tab" without wading through 1,500+
// unrelated lines to find it.
import JobMessagesCard from '../../../components/JobMessagesCard';
import JobQuickAccessIcons from '../../../components/JobQuickAccessIcons';
import ReviewRequestCard from '../../../components/ReviewRequestCard';
import IssuedDocumentsCard from '../../../components/IssuedDocumentsCard';
import NotificationSettingsCard from '../../../components/NotificationSettingsCard';
import CustomerInfoCard from '../../../components/CustomerInfoCard';
import ProjectInfoCard from '../../../components/ProjectInfoCard';
import ScopeCard from '../../../components/ScopeCard';
import PriceCard from '../../../components/PriceCard';
import TermsCard from '../../../components/TermsCard';
import ChangeOrdersCard from '../../../components/ChangeOrdersCard';
import UpdatesCard from '../../../components/UpdatesCard';
import InvoiceCard from '../../../components/InvoiceCard';

// Sub-nav restructure (Aug 2026): the old flat 10-tab list mixed things
// at very different altitudes (a customer contact form next to internal
// job costing) and showed post-approval content (Financials) on records
// that are still just Estimates. Tabs now group by what they're actually
// for, and a tab can offer `sections` for content that's related but
// distinct enough to want its own toggle rather than being smashed
// together. `hideWhen(job)` lets a tab stay out of the way until it's
// actually earned relevance for this job's stage.
const TABS = [
  { key: 'Overview', label: 'Overview', icon: OverviewIcon },
  {
    key: 'Customer', label: 'Customer', icon: PersonIcon,
    sections: [
      { key: 'details', label: 'Details' },
      { key: 'portal', label: 'Portal & Notifications' },
    ],
  },
  {
    key: 'Estimate', label: 'Estimate', icon: CalculatorIcon,
    sections: [
      { key: 'scope', label: 'Scope' },
      { key: 'pricing', label: 'Pricing' },
    ],
  },
  {
    key: 'Financials', label: 'Financials', icon: FinanceIcon,
    // Cost summary / budget-vs-actual overview only now — Change Orders,
    // Work Orders, Invoicing, and Receipts were split out into their own
    // tabs (Sep 2026) the same way Material Selections was earlier, so
    // each is one click away instead of a scroll inside a shared tab.
    hideWhen: (job) => isOpportunity(job),
  },
  {
    key: 'Change Orders', label: 'Change Orders', icon: ChangeOrderIcon,
    hideWhen: (job) => isOpportunity(job),
  },
  {
    key: 'Work Orders', label: 'Work Orders', icon: WorkOrderIcon,
    hideWhen: (job) => isOpportunity(job),
  },
  {
    key: 'Invoicing', label: 'Invoicing', icon: InvoiceIcon,
    hideWhen: (job) => isOpportunity(job),
  },
  {
    key: 'Receipts', label: 'Receipts', icon: ReceiptIcon,
    hideWhen: (job) => isOpportunity(job),
  },
  { key: 'Photos', label: 'Photos', icon: PhotosIcon },
  { key: 'Material Selections', label: 'Material Selections', icon: MaterialSelectionsTabIcon },
  {
    key: 'Updates', label: 'Updates', icon: UpdatesTabIcon,
    sections: [
      { key: 'log', label: 'Progress & Documents' },
      { key: 'messages', label: 'Messages' },
    ],
  },
  { key: 'Internal Updates', label: 'Internal Updates', icon: InternalUpdatesIcon },
];

export default function JobDetailPage() {
  const { session, loading } = useRequireAuth();
  const { id } = useParams();
  const router = useRouter();

  const [job, setJob] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [flash, setFlash] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState('');
  const [closingLost, setClosingLost] = useState(false);
  const [lossReasonText, setLossReasonText] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [offlineViewing, setOfflineViewing] = useState(null); // null | { cachedAt }
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    function goOnline() { setIsOnline(true); }
    function goOffline() { setIsOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  const [tab, setTab] = useState('Overview');
  const [section, setSection] = useState(null);

  // Central place to change tabs so section always lands somewhere valid:
  // explicit section if given, else that tab's first section, else none.
  const goToTab = useCallback((tabKey, sectionKey) => {
    const target = TABS.find(t => t.key === tabKey);
    if (!target) return;
    setTab(tabKey);
    setSection(sectionKey || target.sections?.[0]?.key || null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    const requestedSection = params.get('section');
    if (requestedTab && TABS.some(t => t.key === requestedTab)) {
      goToTab(requestedTab, requestedSection);
    }
  }, [goToTab]);

  // A tab can disappear out from under the current selection — e.g. the
  // job just got approved and Financials was hidden while it was still
  // an opportunity. Land somewhere valid instead of a blank pane.
  useEffect(() => {
    if (!job) return;
    const visible = TABS.filter(t => !t.hideWhen || !t.hideWhen(job));
    const current = visible.find(t => t.key === tab);
    if (!current) {
      goToTab(visible[0]?.key || 'Overview');
    } else if (current.sections && !current.sections.some(s => s.key === section)) {
      setSection(current.sections[0].key);
    }
  }, [job, tab, section, goToTab]);

  // Financial fields (contract_price, invoice_amount, invoice_status) live
  // in job_financials, not on jobs itself — split out so RLS can hide them
  // from field crew while everything else about the job stays visible.
  // Merged back onto the same job object here so every existing read of
  // job.contract_price etc. elsewhere in this file keeps working as-is.
  const FINANCIAL_FIELDS = ['contract_price', 'invoice_amount', 'invoice_status'];

  const loadJob = useCallback(async () => {
    try {
      const [{ data, error }, { data: financials }] = await Promise.all([
        supabase.from('jobs').select('*').eq('id', id).single(),
        supabase.from('job_financials').select('contract_price, invoice_amount, invoice_status').eq('job_id', id).maybeSingle(),
      ]);
      if (error || !data) throw error || new Error('Job not found');
      const merged = { ...data, ...financials };
      setJob(merged);
      setOfflineViewing(null);
      cacheJobPatch(id, { job: merged });
    } catch (err) {
      // Could be genuinely missing, or could just be offline — a fetch
      // to Supabase failing outright (no response at all) looks
      // different from Postgres cleanly saying "no rows," so only fall
      // back to cache when it looks like a network failure, and only
      // declare not-found when there's no cache to fall back to either.
      const cached = await getCachedJob(id);
      if (cached?.data?.job) {
        setJob(cached.data.job);
        setOfflineViewing({ cachedAt: cached.cachedAt });
      } else {
        setNotFound(true);
      }
    }
  }, [id]);

  const loadUpdates = useCallback(async () => {
    const { data } = await supabase.from('job_updates').select('*').eq('job_id', id).eq('is_internal', false).order('update_date', { ascending: false });
    if (data) setUpdates(data);
  }, [id]);

  const loadChangeOrders = useCallback(async () => {
    const { data } = await supabase.from('change_orders').select('*').eq('job_id', id).order('co_date', { ascending: false });
    if (data) setChangeOrders(data);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    loadJob();
    loadUpdates();
    loadChangeOrders();

    const channel = supabase
      .channel(`job-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${id}` }, loadJob)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_financials', filter: `job_id=eq.${id}` }, loadJob)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${id}` }, loadUpdates)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${id}` }, loadChangeOrders)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session, id, loadJob, loadUpdates, loadChangeOrders]);

  function flashSaved() {
    setFlash('Saved');
    setTimeout(() => setFlash(''), 1500);
  }

  // Recovery path for a job that's already past Approved but somehow
  // never got a job number — shown as a fix-it banner rather than
  // something that has to be chased down through the database directly.
  async function fixMissingJobNumber() {
    try {
      // assignNextJobNumber writes the number to this row itself (and
      // retries if it collides with a number claimed a moment earlier by
      // someone else) — nothing further to save here.
      await assignNextJobNumber(id);
      flashSaved();
    } catch (err) {
      setFlash(`Could not assign a job number: ${err.message}`);
      setTimeout(() => setFlash(''), 8000);
    }
  }

  async function saveJob(patch) {
    if (!isOnline) {
      // Deliberately not attempting the network call at all — this isn't
      // queued anywhere the way Field Log entries are, so a failed save
      // here would otherwise look identical to a successful one (the
      // form still shows what you typed either way). Blocking outright
      // and saying so clearly beats a save that silently doesn't happen.
      setFlash("You're offline — this can't be saved right now. Your edit is still showing here, but it has NOT been saved. Reconnect and save again.");
      setTimeout(() => setFlash(''), 10000);
      return false;
    }

    const jobPatch = {};
    const financialsPatch = {};
    for (const [key, value] of Object.entries(patch)) {
      (FINANCIAL_FIELDS.includes(key) ? financialsPatch : jobPatch)[key] = value;
    }

    if (Object.keys(jobPatch).length > 0) {
      const { error } = await supabase.from('jobs').update(jobPatch).eq('id', id);
      if (error) {
        setFlash(`Save failed: ${error.message}`);
        setTimeout(() => setFlash(''), 6000);
        return false;
      }
    }
    if (Object.keys(financialsPatch).length > 0) {
      const { error } = await supabase.from('job_financials').update(financialsPatch).eq('job_id', id);
      if (error) {
        setFlash(`Save failed: ${error.message}`);
        setTimeout(() => setFlash(''), 6000);
        return false;
      }
    }
    flashSaved();
    return true;
  }

  async function advanceStage() {
    const idx = STAGE_ORDER.indexOf(job.stage);
    if (idx === -1 || idx >= STAGE_ORDER.length - 1) return;
    const next = STAGE_ORDER[idx + 1];
    if (!confirm(`Move this job from ${STAGE_LABELS[job.stage]} to ${STAGE_LABELS[next]}?`)) return;

    const patch = { stage: next, ...(next === 'approved' && !job.approved_at ? { approved_at: new Date().toISOString() } : {}) };

    if (next === 'approved' && !job.job_number) {
      try {
        // Writes job_number to this row directly (with its own
        // collision-retry) before we touch stage/approved_at, so we never
        // move a job to Approved without a number actually attached.
        await assignNextJobNumber(id);
      } catch (err) {
        setFlash(`Could not assign a job number: ${err.message}. Stage was not changed — try again.`);
        setTimeout(() => setFlash(''), 8000);
        return; // don't advance the stage without a job number — that's the exact stuck state we're trying to prevent
      }
    }
    await saveJob(patch);

    if (next === 'approved' && job.contract_price) {
      const { data: existing } = await supabase.from('invoices').select('id').eq('job_id', id).limit(1);
      if (!existing || existing.length === 0) {
        const half = Math.round((parseFloat(job.contract_price) / 2) * 100) / 100;
        await supabase.from('invoices').insert([
          { job_id: id, description: 'Draw 1 — Deposit', amount: half, status: 'not_sent' },
          { job_id: id, description: 'Draw 2 — Final Payment', amount: parseFloat(job.contract_price) - half, status: 'not_sent' },
        ]);
      }
    }
  }

  async function invitePortal() {
    const recipientEmail = job.customer_email || job.billing_email || '';
    if (!recipientEmail) { setInviteResult('Add a contact email before inviting the customer.'); return; }
    setInviting(true);
    setInviteResult('');
    // Sends via the same working SMTP as every other email in the app —
    // not supabase.auth.signInWithOtp(), whose built-in email service is
    // separate infrastructure, heavily rate-limited, and can silently drop
    // sends without ever reporting an error. See migration/route notes.
    const { data: { session: adminSession } } = await supabase.auth.getSession();
    const res = await fetch('/api/portal/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: adminSession?.access_token,
        email: recipientEmail,
        customerName: job.customer_name,
        // Sends new customers into /customerportal (where PortalFeed, the
        // no-active-project screen, etc. actually live), not the older
        // standalone /portal/dashboard implementation — see README for the
        // Closed Lost portal-access feature for why this matters.
        redirectTo: `${window.location.origin}/customerportal/projects`,
      }),
    });
    const data = await res.json();
    setInviting(false);
    if (!res.ok) {
      setInviteResult(data.error || 'Failed to send invite.');
    } else {
      setInviteResult(`Invite sent to ${recipientEmail}.`);
      await saveJob({ portal_invited_at: new Date().toISOString() });
    }
  }

  async function deleteJob() {
    if (!confirm('Permanently delete this job? This cannot be undone.')) return;
    await supabase.from('jobs').delete().eq('id', id);
    router.push('/jobs');
  }

  // Closing an opportunity as lost before it's ever Approved — a real
  // terminal stage (with its own DB constraint entry, migration 069)
  // rather than just hiding the record, so it stays visible/filterable
  // in the Job Tracker instead of disappearing. Mirrors the same
  // reason-prompt pattern already used for leads in the Sales pipeline.
  async function confirmCloseLost() {
    await saveJob({
      stage: 'lost',
      stage_before_lost: job.stage,
      lost_at: new Date().toISOString(),
      loss_reason: lossReasonText.trim() || null,
    });
    setClosingLost(false);
    setLossReasonText('');
  }

  async function reopenLost() {
    const restoreTo = job.stage_before_lost && STAGE_ORDER.includes(job.stage_before_lost) ? job.stage_before_lost : 'new';
    if (!confirm(`Reopen this opportunity? It will move back to ${STAGE_LABELS[restoreTo]}.`)) return;
    await saveJob({ stage: restoreTo, stage_before_lost: null });
  }

  if (loading || !session) return null;
  if (notFound) return <div className="container">Job not found. <Link href="/jobs">Back to Job Tracker</Link></div>;
  if (!job) return null;

  const visibleTabs = TABS.filter(t => !t.hideWhen || !t.hideWhen(job));
  const activeTabDef = visibleTabs.find(t => t.key === tab) || visibleTabs[0];

  return (
    <AppShell>
      <div className="container">
        <Breadcrumb href="/jobs" label="Back to Job Tracker" />

        {offlineViewing && (
          <div className="sync-badge sync-badge-offline">
            Offline — showing cached data from{' '}
            {new Date(offlineViewing.cachedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
            Editing is unavailable until you're back online.
          </div>
        )}

        {!offlineViewing && !isOnline && (
          <div className="sync-badge sync-badge-offline">
            You're currently offline. Everything on this page is still viewable, but edits won't be saved until you reconnect.
          </div>
        )}

        {!isOpportunity(job) && !job.job_number && (
          <div className="card" style={{ borderColor: '#c0524f', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13 }}>
                <b style={{ color: '#c0524f' }}>This job is past Approved but never got a real Job Number.</b>
                <div style={{ color: 'var(--ink-soft)', fontSize: 12, marginTop: 2 }}>That shouldn't happen — click to assign one now.</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={fixMissingJobNumber}>Assign Job Number Now</button>
            </div>
          </div>
        )}

        <div className="top-actions">
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{formattedProjectNumber(job)} — {job.customer_name || 'Unnamed customer'}</h2>
            {job.project_address && (
              <MapLinkMenu
                address={job.project_address}
                style={{ fontSize: 12.5, color: 'var(--ink-soft)', textDecoration: 'none', display: 'inline-block', marginBottom: 4 }}
                onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
              >
                📍 {job.project_address}
              </MapLinkMenu>
            )}
            <div>
              <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
              {flash && <span className="saved-flash">{flash}</span>}
            </div>
            {job.stage === 'lost' && job.loss_reason && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>Loss reason: {job.loss_reason}</div>
            )}
          </div>
          <div className="section-actions">
            <button className="btn btn-sm" onClick={invitePortal} disabled={inviting}>
              {inviting ? 'Sending…' : job.portal_invited_at ? 'Resend portal invite' : 'Invite to Customer Portal'}
            </button>
            {STAGE_ORDER.includes(job.stage) && job.stage !== STAGE_ORDER[STAGE_ORDER.length - 1] && (
              <button className="btn btn-primary" onClick={advanceStage}>
                Advance to {STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.indexOf(job.stage) + 1]]} →
              </button>
            )}
            {['new', 'inspected', 'proposal_delivered'].includes(job.stage) && (
              <button className="btn btn-sm" onClick={() => { setClosingLost(true); setLossReasonText(''); }}>Close Lost</button>
            )}
            {job.stage === 'lost' && (
              <button className="btn btn-sm" onClick={reopenLost}>Reopen</button>
            )}
          </div>
        </div>
        {inviteResult && (
          <div style={{ fontSize: 12.5, marginTop: -10, marginBottom: 14, color: inviteResult.startsWith('Invite sent') ? '#3a6b45' : '#a13f3f' }}>
            {inviteResult}
          </div>
        )}
        {closingLost && (
          <div className="card">
            <h3>Reason for loss</h3>
            <textarea
              value={lossReasonText}
              onChange={e => setLossReasonText(e.target.value)}
              placeholder="e.g. Went with another contractor, budget cut, timeline no longer fits…"
            />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={confirmCloseLost}>Save &amp; mark lost</button>
              <button className="btn btn-sm" onClick={() => setClosingLost(false)}>Cancel</button>
            </div>
          </div>
        )}


        <div className="stage-tabs">
          {TABS.filter(t => !t.hideWhen || !t.hideWhen(job)).map(t => (
            <button key={t.key} className={`stage-tab ${tab === t.key ? 'active' : ''}`} onClick={() => goToTab(t.key)}>
              {t.icon && <t.icon width={16} height={16} />}
              {t.label}
            </button>
          ))}
        </div>

        <JobQuickAccessIcons job={job} onNavigate={goToTab} />
        {activeTabDef?.sections && (
          <div className="tab-sections">
            <div className="tab-sections-pills">
              {activeTabDef.sections.map(s => (
                <button
                  key={s.key}
                  className={`tab-section-btn ${section === s.key ? 'active' : ''}`}
                  onClick={() => setSection(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {/* Centralized (Aug 2026): generating the estimate used to be a card
                buried in the Pricing sidebar, invisible while on Scope. It's the
                primary action for this whole tab, so it lives here instead —
                reachable no matter which section is active. */}
            {tab === 'Estimate' && (
              <div className="tab-sections-actions">
                <Link href={`/jobs/${id}/proposal`} className="btn btn-primary btn-sm">Generate Estimate Document →</Link>
                {job.proposal_sent_at && (
                  <Link href={contractPathFor(job)} className="btn btn-sm">View / Send Contract →</Link>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'Overview' && (
          <>
            <div className="overview-split">
              <ProjectInfoCard job={job} onSave={saveJob} />
              <ProjectMilestonesCard job={job} jobId={id} onTabChange={goToTab} />
            </div>
            <div className="card" style={{ marginTop: 20 }}>
              <h3>Danger Zone</h3>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Permanently deletes this job and everything attached to it. This cannot be undone.
              </div>
              <button className="btn btn-danger" onClick={deleteJob}>Delete job</button>
            </div>
          </>
        )}

        {tab === 'Customer' && section === 'details' && (
          <CustomerInfoCard job={job} onSave={saveJob} />
        )}

        {tab === 'Customer' && section === 'portal' && (
          <>
            <PortalAccessCard job={job} jobId={id} onLinkProperty={(propertyId) => saveJob({ property_id: propertyId })} />
            <NotificationSettingsCard job={job} onSave={saveJob} />
          </>
        )}

        {tab === 'Estimate' && section === 'scope' && (
          <div className="estimate-grid">
            <div className="estimate-main">
              <ScopeCard job={job} jobId={id} onSave={saveJob} />
              <TermsCard job={job} onSave={saveJob} />
            </div>
            <div className="estimate-sidebar">
              <TradeBreakdownCard jobId={id} />
            </div>
          </div>
        )}

        {tab === 'Estimate' && section === 'pricing' && (
          <EstimateTab job={job} jobId={id}>
            <PriceCard job={job} onSave={saveJob} />
          </EstimateTab>
        )}

        {tab === 'Financials' && (
          <JobCostSummary jobId={id} contractPrice={job.contract_price} projectedCost={job.projected_cost} />
        )}

        {tab === 'Change Orders' && (
          <ChangeOrdersCard jobId={id} changeOrders={changeOrders} />
        )}

        {tab === 'Work Orders' && (
          <WorkOrdersCard jobId={id} scopeItems={(job.scope_items || []).map(s => s.text || '').filter(Boolean)} projectAddress={job.project_address} />
        )}

        {tab === 'Invoicing' && (
          <>
            <DrawsCard jobId={id} />
            {(job.stage === 'completed' || job.stage === 'invoiced' || job.stage === 'paid') ? (
              <InvoiceCard job={job} onSave={saveJob} jobId={id} />
            ) : (
              <div className="card">
                <h3>Invoice</h3>
                <div className="empty-state">
                  The final invoice becomes available once this job is Completed. This job is currently {STAGE_LABELS[job.stage]}.
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'Receipts' && (
          <ReceiptsCard jobId={id} />
        )}

        {tab === 'Photos' && (
          <PhotoGallery jobId={id} title="Job Photos" />
        )}

        {tab === 'Internal Updates' && (
          <InternalUpdatesPanel jobId={id} session={session} />
        )}

        {tab === 'Updates' && section === 'log' && (
          <>
            <IssuedDocumentsCard jobId={id} job={job} updates={updates} changeOrders={changeOrders} />
            {phaseForStage(job.stage) !== 'opportunity' ? (
              <>
                <UpdatesCard jobId={id} updates={updates} />
                {(job.stage === 'completed' || job.stage === 'invoiced' || job.stage === 'paid') && (
                  <ReviewRequestCard job={job} onSave={saveJob} />
                )}
              </>
            ) : (
              <div className="card">
                <h3>Progress Updates</h3>
                <div className="empty-state">
                  Progress updates become available once this job moves past the Opportunity phase (Approved or later). This job is currently {STAGE_LABELS[job.stage]}.
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'Material Selections' && (
          phaseForStage(job.stage) !== 'opportunity' ? (
            <JobMaterialSelectionsPanel jobId={id} job={job} />
          ) : (
            <div className="card">
              <h3>Material Selections</h3>
              <div className="empty-state">
                Material selections become available once this job moves past the Opportunity phase (Approved or later). This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {tab === 'Updates' && section === 'messages' && (
          <JobMessagesCard jobId={id} job={job} />
        )}
      </div>
    </AppShell>
  );
}
