'use client';
import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import Breadcrumb from '../../../components/Breadcrumb';
import BottomSheet from '../../../components/BottomSheet';
import JobQuickActions, { buildQuickActions } from '../../../components/JobQuickActions';
import PhotoGallery from '../../../components/PhotoGallery';
import InternalUpdatesPanel from '../../../components/InternalUpdatesPanel';
import JobCostSummary from '../../../components/JobCostSummary';
import DrawsCard from '../../../components/DrawsCard';
import ReceiptsCard from '../../../components/ReceiptsCard';
import WorkOrdersCard from '../../../components/WorkOrdersCard';
import JobRfpsPanel from '../../../components/JobRfpsCard';
import PortalAccessCard from '../../../components/PortalAccessCard';
import EstimateTab from '../../../components/EstimateTab';
import { assignNextJobNumber } from '../../../lib/assignJobNumber';
import JobMaterialSelectionsPanel from '../../../components/JobMaterialSelectionsPanel';
import ProjectMilestonesCard from '../../../components/ProjectMilestonesCard';
import EmailThreadCard from '../../../components/EmailThreadCard';
import { cacheJobPatch, getCachedJob } from '../../../lib/offlineDb';
import MapLinkMenu from '../../../components/MapLinkMenu';
import { STAGE_ORDER, STAGE_LABELS, phaseForStage, contractPathFor, formattedProjectNumber, isOpportunity } from '../../../lib/constants';
import {
  OverviewIcon, PersonIcon, CalculatorIcon, JobDashboardIcon, InvoiceIcon,
  PhotosIcon, MaterialSelectionsTabIcon, ProjectFeedIcon, InternalUpdatesIcon, MessagesIcon, UpdatesTabIcon, PlusIcon, WorkOrderIcon,
} from '../../../components/icons';

// Sub-nav restructure Part 2 (Sep 2026): this file used to also define
// the 12 card components below directly — now each lives in its own
// file under components/, imported here like everything else. Same
// behavior, same props, nothing moved data-wise; this just makes it
// possible to open "the Scope tab" without wading through 1,500+
// unrelated lines to find it.
import JobMessagesCard from '../../../components/JobMessagesCard';
import ReviewRequestCard from '../../../components/ReviewRequestCard';
import IssuedDocumentsCard from '../../../components/IssuedDocumentsCard';
import NotificationSettingsCard from '../../../components/NotificationSettingsCard';
import CustomerInfoCard from '../../../components/CustomerInfoCard';
import ProjectInfoCard from '../../../components/ProjectInfoCard';
import ScopeCard from '../../../components/ScopeCard';
import ScheduleCard from '../../../components/ScheduleCard';
import JobScheduleEventsCard from '../../../components/JobScheduleEventsCard';
import NewEventModal from '../../../components/NewEventModal';
import ScheduleDelayCard from '../../../components/ScheduleDelayCard';
import ScheduleRiskBadge from '../../../components/ScheduleRiskBadge';
import PriceCard from '../../../components/PriceCard';
import TermsCard from '../../../components/TermsCard';
import ChangeOrdersCard from '../../../components/ChangeOrdersCard';
import UpdatesCard from '../../../components/UpdatesCard';
import InvoiceCard from '../../../components/InvoiceCard';
import ReadyToInvoiceCard from '../../../components/ReadyToInvoiceCard';
import BudgetCard from '../../../components/BudgetCard';
import PayAppsCard from '../../../components/PayAppsCard';
import LienWaiversCard from '../../../components/LienWaiversCard';
import PunchItemsPanel from '../../../components/PunchItemsPanel';
import WarrantyCard from '../../../components/WarrantyCard';
import BlackoutDatesCard from '../../../components/BlackoutDatesCard';
import PlansPanel from '../../../components/PlansPanel';
import { normalizeJobLink, JOB_DESTINATIONS, stageLanding, stageTab, billingDestination } from '../../../lib/links';

// Job page structure (Oct 2026): tabs follow the life of a project instead
// of the feature that produced the data.
//   Sell      winning the work   - scope, cost, pricing, plans
//   Plan      getting ready      - budget, material selections, work orders
//   Build     doing the work     - updates, change orders, job costs, draws, pay apps, waivers
//   Closeout  finishing up       - punch list, warranty, final invoice, review request
// plus tabs that matter at every stage (Overview, Schedule, Photos,
// Documents, Messages). A job opens on the tab for the stage it is in; the
// other stage tabs stay one click away because plans change mid-project.
//
// A tab can offer `sections` for content that is related but distinct
// enough to want its own toggle. Every link into this page goes through
// lib/links.js (JOB_DESTINATIONS), which is checked against this array at
// build time (scripts/check-link-destinations.mjs) - add a section here and
// a destination there, and old URLs are handled by normalizeJobLink().
const TABS = [
  {
    key: 'Overview', label: 'Overview', icon: OverviewIcon, group: 'home',
    sections: [
      { key: 'summary', label: 'Summary' },
      { key: 'customer', label: 'Customer' },
      { key: 'financials', label: 'Financials' },
    ],
  },
  {
    key: 'Sell', label: 'Sell', icon: CalculatorIcon, group: 'stage',
    sections: [
      { key: 'scope', label: 'Scope' },
      { key: 'cost', label: 'Cost' },
      { key: 'pricing', label: 'Pricing' },
      { key: 'floorplan', label: 'Plans' },
    ],
  },
  {
    key: 'Plan', label: 'Plan', icon: MaterialSelectionsTabIcon, group: 'stage',
    sections: [
      { key: 'budget', label: 'Budget' },
      { key: 'approved', label: 'Approved Materials' },
      { key: 'all', label: 'Selection Sheets' },
      { key: 'work_orders', label: 'Work Orders' },
    ],
  },
  {
    key: 'Build', label: 'Build', icon: WorkOrderIcon, group: 'stage',
    sections: [
      { key: 'updates', label: 'Project Updates' },
      { key: 'internal', label: 'Internal Updates' },
      { key: 'change_orders', label: 'Change Orders' },
      { key: 'job_costs', label: 'Job Costs' },
      { key: 'draws', label: 'Draws' },
      { key: 'pay_apps', label: 'Pay Apps' },
      { key: 'waivers', label: 'Lien Waivers' },
    ],
  },
  {
    key: 'Closeout', label: 'Closeout', icon: InvoiceIcon, group: 'stage',
    sections: [
      { key: 'punch', label: 'Punch List' },
      { key: 'warranty', label: 'Warranty' },
      { key: 'invoice', label: 'Final Invoice' },
      { key: 'review', label: 'Review Request' },
    ],
  },
  { key: 'Schedule', label: 'Schedule', icon: JobDashboardIcon, group: 'always' },
  { key: 'Photos', label: 'Photos', icon: PhotosIcon, group: 'always' },
  { key: 'Documents', label: 'Documents', icon: UpdatesTabIcon, group: 'always' },
  {
    key: 'Messages', label: 'Messages', icon: MessagesIcon, group: 'always',
    sections: [
      { key: 'messages', label: 'Customer Messages' },
      { key: 'email', label: 'Email' },
    ],
  },
];

export default function JobDetailPage() {
  const { session, loading, role } = useRequireAuth();
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
  const [isMobile, setIsMobile] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [rfpPanelOpen, setRfpPanelOpen] = useState(false);
  const [scheduleItemOpen, setScheduleItemOpen] = useState(false);

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

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);
  const [tab, setTab] = useState('Overview');
  const [section, setSection] = useState(null);
  // Overview > Customer has two views: the customer's details, and their
  // portal access and notification settings. Kept out of TABS because it is a
  // switch inside one section, not a section of its own (see `view` in lib/links.js).
  const [customerView, setCustomerView] = useState('details');
  // Landing: a job opens on the tab for its current stage unless the URL
  // names a destination. These refs carry what the URL said until the job
  // has loaded and we know its stage.
  const urlNamedTabRef = useRef(false);
  const billingPendingRef = useRef(false);
  const landedRef = useRef(false);
  // Which destination should open with its "new" form already showing
  // (set by Quick actions or a ?new=1 link; cleared by any other navigation).
  const [autoOpen, setAutoOpen] = useState(null);

  // Central place to change tabs so section always lands somewhere valid:
  // explicit section if given, else that tab's first section, else none.
  // Also keeps the URL in sync (?tab=&section=) — this used to only set
  // local state, so refreshing (or bookmarking/sharing a link) while on
  // any tab besides Overview always landed back on Overview, since the
  // URL never actually reflected where you'd navigated to.
  const goToTab = useCallback((tabKey, sectionKey, view) => {
    const target = TABS.find(t => t.key === tabKey);
    if (!target) return;
    const resolvedSection = sectionKey || target.sections?.[0]?.key || null;
    const resolvedView = tabKey === 'Overview' && resolvedSection === 'customer' && view === 'portal' ? 'portal' : null;
    setTab(tabKey);
    setSection(resolvedSection);
    setCustomerView(resolvedView || 'details');
    setAutoOpen(null);
    syncUrl(tabKey, resolvedSection, resolvedView);
  }, []);

  // Same idea, for switching sections within a tab (e.g. Financials'
  // Invoicing/Receipts sub-nav) without changing the tab itself.
  const goToSection = useCallback((sectionKey) => {
    setSection(sectionKey);
    setCustomerView('details');
    setAutoOpen(null);
    syncUrl(tab, sectionKey, null);
  }, [tab]);

  // Switches between the two views inside Overview > Customer.
  const goToCustomerView = useCallback((view) => {
    setCustomerView(view);
    syncUrl('Overview', 'customer', view === 'portal' ? 'portal' : null);
  }, []);

  // Navigate by destination name (see JOB_DESTINATIONS in lib/links.js), so
  // nothing in this file needs to know which tab a feature lives under.
  const goDest = useCallback((destination) => {
    const d = JOB_DESTINATIONS[destination];
    if (d) goToTab(d.tab, d.section, d.view);
  }, [goToTab]);

  // Same, but the destination opens with its "new ..." form ready to fill in.
  const goCreate = useCallback((destination) => {
    goDest(destination);
    setAutoOpen(destination);
  }, [goDest]);

  function syncUrl(tabKey, sectionKey, view) {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tabKey);
    params.delete('new');
    if (sectionKey) params.set('section', sectionKey); else params.delete('section');
    if (view) params.set('view', view); else params.delete('view');
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    // normalizeJobLink forgives case and retired section names, so old
    // bookmarks (?tab=schedule, section=proposals) land somewhere real
    // instead of being silently ignored.
    const target = normalizeJobLink(TABS, params.get('tab'), params.get('section'), params.get('view'));
    if (target) {
      urlNamedTabRef.current = true;
      billingPendingRef.current = target.stageAware === 'billing';
      goToTab(target.tab, target.section, target.view);
      // ?new=1 (jobHref(id, dest, { new: 1 })) opens that destination's create form.
      if (params.get('new')) {
        const resolved = target.section || TABS.find(t => t.key === target.tab)?.sections?.[0]?.key || null;
        const name = Object.keys(JOB_DESTINATIONS).find(k => JOB_DESTINATIONS[k].tab === target.tab && (JOB_DESTINATIONS[k].section || null) === resolved && (JOB_DESTINATIONS[k].view || null) === (target.view || null));
        if (name) setAutoOpen(name);
      }
    }
  }, [goToTab]);

  // Once the job has loaded: land on the right spot for its stage (unless
  // the URL asked for somewhere specific), and settle old "billing" links
  // onto draws or the final invoice depending on where the job is now.
  useEffect(() => {
    if (!job || landedRef.current) return;
    landedRef.current = true;
    if (billingPendingRef.current) {
      billingPendingRef.current = false;
      goDest(billingDestination(job.stage));
      return;
    }
    if (urlNamedTabRef.current) return;
    const landing = stageLanding(job.stage);
    goToTab(landing.tab, landing.section);
  }, [job, goToTab, goDest]);

  // A tab can disappear out from under the current selection — e.g. the
  // job just got approved and Financials was hidden while it was still
  // an opportunity. Land somewhere valid instead of a blank pane.
  useEffect(() => {
    if (!job) return;
    const current = TABS.find(t => t.key === tab);
    if (!current) {
      goToTab('Overview');
    } else if (current.sections && !current.sections.some(s => s.key === section)) {
      setSection(current.sections[0].key);
      setCustomerView('details');
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
        supabase.from('job_financials').select('contract_price, invoice_amount, invoice_status, priced_at').eq('job_id', id).maybeSingle(),
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
    // Merge locally rather than depending solely on the jobs realtime
    // channel — this is the single most-used save path in the app, so
    // it's worth not leaving it dependent on realtime at all.
    setJob(prev => ({ ...prev, ...patch }));
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
        // Rounded to the cent on both sides — contract_price itself is
        // rounded at the source now (see EstimateTab.js), but floating-
        // point subtraction can still reintroduce a fraction-of-a-cent
        // artifact here (e.g. 100.10 - 50.05 = 50.04999999999999 in JS),
        // and this also protects against any already-saved contract
        // price from before that fix.
        const total = Math.round(parseFloat(job.contract_price) * 100) / 100;
        const half = Math.round((total / 2) * 100) / 100;
        await supabase.from('invoices').insert([
          { job_id: id, description: 'Invoice 1 — Deposit', amount: half, status: 'not_sent' },
          { job_id: id, description: 'Invoice 2 — Final Payment', amount: Math.round((total - half) * 100) / 100, status: 'not_sent' },
        ]);
      }
    }
  }

  async function invitePortal() {
    const recipientEmail = job.customer_email || job.billing_email || '';
    if (!recipientEmail) { setInviteResult('Add a contact email before inviting the customer.'); return; }
    setInviting(true);
    setInviteResult('');
    // Sends a real activation invite — "create your account" with a
    // password, not a plain magic-link sign-in — the same flow used for
    // newly created jobs. Idempotent: a no-op (and no duplicate email) if
    // this customer already activated an account on another job.
    const { data: { session: adminSession } } = await supabase.auth.getSession();
    const res = await fetch('/api/portal/create-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: adminSession?.access_token,
        email: recipientEmail,
        customerName: job.customer_name,
        jobId: id,
      }),
    });
    const data = await res.json();
    setInviting(false);
    if (!res.ok) {
      setInviteResult(data.error || 'Failed to send invite.');
    } else if (data.alreadyActivated) {
      setInviteResult(`${recipientEmail} already has an active portal account — nothing to send.`);
    } else {
      setInviteResult(`Activation invite sent to ${recipientEmail}.`);
      await saveJob({ portal_invited_at: new Date().toISOString() });
    }
  }

  async function deleteJob() {
    if (!confirm('Permanently delete this job? This cannot be undone.')) return;
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) {
      setFlash(`Delete failed: ${error.message}`);
      setTimeout(() => setFlash(''), 8000);
      return;
    }
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
  if (notFound) return <div className="container">Job not found. <Link href="/jobs">Back to Overview</Link></div>;
  if (!job) return null;

  const activeTabDef = TABS.find(t => t.key === tab) || TABS[0];
  const currentStageTab = stageTab(job.stage);

  const afterOpportunity = phaseForStage(job.stage) !== 'opportunity';
  const inFieldPhase = ['active', 'completed', 'invoiced', 'paid'].includes(job.stage);
  const isDone = ['completed', 'invoiced', 'paid'].includes(job.stage);
  const quickGroups = buildQuickActions({
    job, role, stageTab: currentStageTab, afterOpportunity, inFieldPhase, isDone,
    inviting, go: goDest, create: goCreate, push: (href) => router.push(href),
    onRfp: () => setRfpPanelOpen(true), onInvite: invitePortal,
    onAddScheduleItem: () => setScheduleItemOpen(true),
  });
  return (
    <AppShell>
      <div className="container">
        <Breadcrumb href="/jobs" label="Back to Overview" />

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
            {/* Messages / Project Updates / portal invite are quick-access
                shortcuts that duplicate their own tabs — on mobile these
                move into the ever-present FAB below instead of crowding
                this row. */}
            {!isMobile && <JobQuickActions groups={quickGroups} />}
            {/* Stage Advance dropped on mobile — it's an easy accidental
                tap on a small screen next to Close Lost/Reopen, and the
                job's stage badge is already visible right above. */}
            {!isMobile && STAGE_ORDER.includes(job.stage) && job.stage !== STAGE_ORDER[STAGE_ORDER.length - 1] && (
              <button className="btn btn-primary" onClick={advanceStage}>
                Advance to {STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.indexOf(job.stage) + 1]]} →
              </button>
            )}
          </div>
        </div>

        {isMobile && (
          <>
            <button
              type="button"
              className="job-fab"
              aria-label="Quick actions"
              onClick={() => setFabOpen(true)}
            >
              <PlusIcon width={24} height={24} />
            </button>
            <BottomSheet open={fabOpen} onClose={() => setFabOpen(false)} title="Quick actions">
              {quickGroups.map(g => (
                <div key={g.key}>
                  <div className={`quick-actions-heading ${g.current ? 'is-current' : ''}`}>{g.label}</div>
                  {g.items.map(item => (
                    <button key={item.key} type="button" className="more-sheet-link" disabled={item.disabled} onClick={() => { setFabOpen(false); item.run(); }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </BottomSheet>
          </>
        )}

        {(role === 'owner' || role === 'estimator') && (
          <JobRfpsPanel open={rfpPanelOpen} onClose={() => setRfpPanelOpen(false)} jobId={id} session={session} projectAddress={job.project_address} />
        )}

        <NewEventModal
          open={scheduleItemOpen}
          onClose={() => setScheduleItemOpen(false)}
          title="Add Schedule Item"
          defaultEventType="site_visit"
          lockedJobId={id}
          lockedJobLabel={job.project_address || job.customer_name || formattedProjectNumber(job)}
        />

        {inviteResult && (
          <div style={{ fontSize: 12.5, marginTop: -10, marginBottom: 14, color: inviteResult.startsWith('Invite sent') ? '#3a6b45' : '#a13f3f' }}>
            {inviteResult}
          </div>
        )}
        <div className="stage-tabs">
          {TABS.map((t, i) => {
            // A thin divider marks where one group of tabs ends (home | the
            // four project stages | tabs that matter at every stage).
            const startsGroup = i > 0 && TABS[i - 1].group !== t.group;
            const isCurrentStage = t.group === 'stage' && t.key === currentStageTab;
            return (
              <Fragment key={t.key}>
                {startsGroup && <span className="stage-tabs-divider" aria-hidden="true" />}
                <button
                  className={`stage-tab ${tab === t.key ? 'active' : ''} ${isCurrentStage ? 'is-current' : ''}`}
                  onClick={() => goToTab(t.key)}
                  title={isCurrentStage ? `This job is in ${STAGE_LABELS[job.stage]}` : undefined}
                >
                  {t.icon && <t.icon width={16} height={16} />}
                  {t.label}
                </button>
              </Fragment>
            );
          })}
        </div>

        {activeTabDef?.sections && (
          <div className="tab-sections">
            <div className="tab-sections-pills">
              {activeTabDef.sections.map(s => (
                <button
                  key={s.key}
                  className={`tab-section-btn ${section === s.key ? 'active' : ''}`}
                  onClick={() => goToSection(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {/* Generating the estimate is the primary action for the whole
                estimating side of Sell, so it is reachable from Scope, Cost
                and Pricing without hunting for it. */}
            {tab === 'Sell' && ['scope', 'cost', 'pricing'].includes(section) && (
              <div className="tab-sections-actions">
                <Link href={`/jobs/${id}/proposal`} className="btn btn-primary btn-sm">Generate Estimate Document →</Link>
                {job.proposal_sent_at && (
                  <Link href={contractPathFor(job)} className="btn btn-sm">View / Send Contract →</Link>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'Overview' && section === 'summary' && (
          <>
            <div className="overview-split">
              <ProjectInfoCard job={job} onSave={saveJob} onNavigate={goDest} />
              <ProjectMilestonesCard job={job} jobId={id} onNavigate={goDest} />
            </div>
            {/* Job Status on the left, Danger Zone on the right (stacked on narrow screens). */}
            <div className="overview-pair">
            {(['new', 'inspected', 'proposal_delivered'].includes(job.stage) || job.stage === 'lost') && (
              <div className="card">
                <h3>Job Status</h3>
                {closingLost ? (
                  <>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>Reason for loss</div>
                    <textarea
                      value={lossReasonText}
                      onChange={e => setLossReasonText(e.target.value)}
                      placeholder="e.g. Went with another contractor, budget cut, timeline no longer fits…"
                    />
                    <div className="section-actions">
                      <button className="btn btn-primary btn-sm" onClick={confirmCloseLost}>Save &amp; mark lost</button>
                      <button className="btn btn-sm" onClick={() => setClosingLost(false)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    {['new', 'inspected', 'proposal_delivered'].includes(job.stage) && (
                      <button className="btn btn-sm" onClick={() => { setClosingLost(true); setLossReasonText(''); }}>Close Lost</button>
                    )}
                    {job.stage === 'lost' && (
                      <button className="btn btn-sm" onClick={reopenLost}>Reopen</button>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="card">
              <h3>Danger Zone</h3>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Permanently deletes this job and everything attached to it. This cannot be undone.
              </div>
              <button className="btn btn-danger" onClick={deleteJob}>Delete job</button>
            </div>
            </div>
          </>
        )}

        {/* ------------------- OVERVIEW: CUSTOMER, FINANCIALS ---------------- */}
        {tab === 'Overview' && section === 'customer' && (
          <>
            {/* Details and Portal & Notifications are two views of the same customer. */}
            <div className="tab-sections" style={{ margin: '0 0 14px' }}>
              <div className="tab-sections-pills">
                <button className={`tab-section-btn ${customerView === 'details' ? 'active' : ''}`} onClick={() => goToCustomerView('details')}>Customer Details</button>
                <button className={`tab-section-btn ${customerView === 'portal' ? 'active' : ''}`} onClick={() => goToCustomerView('portal')}>Portal &amp; Notifications</button>
              </div>
            </div>
            {customerView === 'portal' ? (
              <>
                <PortalAccessCard job={job} jobId={id} onLinkProperty={(propertyId) => saveJob({ property_id: propertyId })} />
                <NotificationSettingsCard job={job} onSave={saveJob} />
              </>
            ) : (
              <CustomerInfoCard job={job} onSave={saveJob} />
            )}
          </>
        )}

        {tab === 'Overview' && section === 'financials' && (
          <JobCostSummary jobId={id} contractPrice={job.contract_price} projectedCost={job.projected_cost} changeOrders={changeOrders} invoiceAmount={job.invoice_amount} invoiceStatus={job.invoice_status} />
        )}

        {/* ------------------------------ SELL ------------------------------ */}
        {tab === 'Sell' && section === 'scope' && (
          <>
            <ScopeCard job={job} jobId={id} onSave={saveJob} />
            <TermsCard job={job} onSave={saveJob} />
          </>
        )}

        {tab === 'Sell' && section === 'cost' && (
          <EstimateTab job={job} jobId={id} section="cost" />
        )}

        {tab === 'Sell' && section === 'pricing' && (
          <EstimateTab job={job} jobId={id} section="pricing">
            <PriceCard job={job} onSave={saveJob} />
          </EstimateTab>
        )}

        {tab === 'Sell' && section === 'floorplan' && (
          <PlansPanel jobId={id} embedded onDone={loadJob} />
        )}

        {/* ------------------------------ PLAN ------------------------------ */}
        {tab === 'Plan' && section === 'budget' && (
          <BudgetCard jobId={id} job={job} />
        )}

        {tab === 'Plan' && (section === 'approved' || section === 'all') && (
          afterOpportunity ? (
            <JobMaterialSelectionsPanel jobId={id} job={job} section={section} />
          ) : (
            <div className="card">
              <h3>Material Selections</h3>
              <div className="empty-state">
                Material selections become available once this job moves past the Opportunity phase (Approved or later). This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {tab === 'Plan' && section === 'work_orders' && (
          <WorkOrdersCard autoOpen={autoOpen === 'workOrders'} jobId={id} scopeItems={(job.scope_items || []).map(s => s.text || '').filter(Boolean)} projectAddress={job.project_address} />
        )}

        {/* ------------------------------ BUILD ----------------------------- */}
        {tab === 'Build' && section === 'updates' && (
          afterOpportunity ? (
            <UpdatesCard autoOpen={autoOpen === 'updates'} jobId={id} updates={updates} onChanged={loadUpdates} session={session} />
          ) : (
            <div className="card">
              <h3>Project Updates</h3>
              <div className="empty-state">
                Progress updates become available once this job moves past the Opportunity phase (Approved or later). This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {tab === 'Build' && section === 'internal' && (
          <InternalUpdatesPanel autoOpen={autoOpen === 'internalUpdates'} jobId={id} session={session} />
        )}

        {tab === 'Build' && section === 'change_orders' && (
          <ChangeOrdersCard autoOpen={autoOpen === 'changeOrders'} jobId={id} changeOrders={changeOrders} onChanged={loadChangeOrders} />
        )}

        {tab === 'Build' && section === 'job_costs' && (
          <ReceiptsCard jobId={id} autoOpen={autoOpen === 'jobCosts'} />
        )}

        {tab === 'Build' && section === 'draws' && (
          <>
            {(job.stage === 'active' || job.stage === 'completed') && job.invoice_status !== 'paid' && (
              <ReadyToInvoiceCard job={job} session={session} onSave={saveJob} />
            )}
            <DrawsCard jobId={id} autoOpen={autoOpen === 'draws'} />
          </>
        )}

        {tab === 'Build' && section === 'pay_apps' && (
          <PayAppsCard jobId={id} job={job} changeOrders={changeOrders} />
        )}

        {tab === 'Build' && section === 'waivers' && (
          <LienWaiversCard autoOpen={autoOpen === 'waivers'} jobId={id} job={job} />
        )}

        {/* ----------------------------- CLOSEOUT --------------------------- */}
        {tab === 'Closeout' && section === 'punch' && (
          inFieldPhase ? (
            <div className="card">
              <h3>Punch List</h3>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
                Final fixes before you close the job. Assign an item to a sub and they update it from their portal; tick &ldquo;show to customer&rdquo; if they should follow along. Open items hold back the review request.
              </div>
              <PunchItemsPanel jobId={id} kind="punch" autoOpen={autoOpen === 'punch'} />
            </div>
          ) : (
            <div className="card">
              <h3>Punch List</h3>
              <div className="empty-state">
                The punch list opens once work is underway (Active or later). This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {tab === 'Closeout' && section === 'warranty' && (
          inFieldPhase ? (
            <WarrantyCard jobId={id} job={job} />
          ) : (
            <div className="card">
              <h3>Warranty</h3>
              <div className="empty-state">
                The warranty period starts when the job is marked Completed. This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {tab === 'Closeout' && section === 'invoice' && (
          <>
            {(job.stage === 'active' || job.stage === 'completed') && job.invoice_status !== 'paid' && (
              <ReadyToInvoiceCard job={job} session={session} onSave={saveJob} />
            )}
            {(job.stage === 'completed' || job.stage === 'invoiced' || job.stage === 'paid') ? (
              <InvoiceCard job={job} onSave={saveJob} jobId={id} />
            ) : (
              <div className="card">
                <h3>Final Invoice</h3>
                <div className="empty-state">
                  The final invoice becomes available once this job is Completed. This job is currently {STAGE_LABELS[job.stage]}.
                </div>
                <div className="section-actions">
                  <button className="btn btn-sm" onClick={() => goDest('draws')}>View progress draws →</button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'Closeout' && section === 'review' && (
          isDone ? (
            <ReviewRequestCard job={job} onSave={saveJob} />
          ) : (
            <div className="card">
              <h3>Review Request</h3>
              <div className="empty-state">
                The review request is available once the job is Completed. This job is currently {STAGE_LABELS[job.stage]}.
              </div>
            </div>
          )
        )}

        {/* ----------------------- AVAILABLE AT EVERY STAGE ----------------- */}
        {tab === 'Schedule' && (
          <>
            <JobScheduleEventsCard jobId={id} onAdd={() => setScheduleItemOpen(true)} />
            <ScheduleCard job={job} jobId={id} />
            <ScheduleRiskBadge jobId={id} />
            <ScheduleDelayCard jobId={id} job={job} />
            <BlackoutDatesCard jobId={id} />
          </>
        )}

        {tab === 'Photos' && (
          <PhotoGallery jobId={id} title="Job Photos" />
        )}

        {tab === 'Documents' && (
          <IssuedDocumentsCard jobId={id} job={job} updates={updates} changeOrders={changeOrders} />
        )}

        {tab === 'Messages' && section === 'messages' && (
          <JobMessagesCard jobId={id} job={job} />
        )}

        {tab === 'Messages' && section === 'email' && (
          <EmailThreadCard jobId={id} job={job} />
        )}
      </div>
    </AppShell>
  );
}
