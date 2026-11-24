'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import Breadcrumb from '@/components/Breadcrumb';
import VisitForm from '@/components/VisitForm';
import PopupModal from '@/components/PopupModal';
import VisitActions from '@/components/VisitActions';
import OnTheWayModal from '@/components/OnTheWayModal';
import AssignJobModal from '@/components/AssignJobModal';
import VisitDock from '@/components/VisitDock';
import ClockCard from '@/components/job/ClockCard';
import EstimateCard from '@/components/EstimateCard';
import PhotosTab from '@/components/job/PhotosTab';
import SketchTab from '@/components/job/SketchTab';
import MoistureTab from '@/components/job/MoistureTab';
import WaterDayOne, { DayOneCard } from '@/components/job/WaterDayOne';
import { usesDayOneSteps, gateFor, canCompleteJob, nextDayOneStep } from '@/lib/waterDayOne';
import InspectionTab from '@/components/job/InspectionTab';
import EvalSheetTab from '@/components/job/EvalSheetTab';
import ReportsTab from '@/components/job/ReportsTab';
import InvoiceTab from '@/components/job/InvoiceTab';
import CostsTab from '@/components/job/CostsTab';
import { normalizePlan } from '@/lib/sketch';
import { unitsStillOnSite } from '@/lib/equipment';
import CustomerPageCard from '@/components/job/CustomerPageCard';
import StreetOffersCard from '@/components/job/StreetOffersCard';
import DeleteJobCard from '@/components/job/DeleteJobCard';
import UpdatesTab from '@/components/job/UpdatesTab';
import ThreadPanel from '@/components/chat/ThreadPanel';
import { useChatCenter } from '@/lib/useChatInbox';
import { useChatDock } from '@/components/chat/ChatDockContext';
import { countForTarget } from '@/lib/chat';
import JobFab from '@/components/job/JobFab';
import QuickActionScreen from '@/components/job/QuickActionScreen';
import QaPageBar from '@/components/job/QaPageBar';
import PhotoViewer from '@/components/job/PhotoViewer';
import CameraCapture from '@/components/job/CameraCapture';
import { useJobRooms } from '@/lib/useJobRooms';
import { useIsMobile } from '@/lib/useIsMobile';
import { useSignedUrls } from '@/lib/useSignedUrls';
import { UploadStatus } from '@/components/job/PhotoUi';
import { usePhotoUploader } from '@/lib/usePhotoUploader';
import { eventLabel, updateRecipients, INTERNAL_CATEGORIES } from '@/lib/jobDocs';
import { fabActions, FAB_LABELS, FAB_HIDDEN_TABS } from '@/lib/jobFab';
import { isTabAction, qaScreenTitle } from '@/lib/quickActions';
import { reasonText } from '@/lib/visitReasons';
import { groupVisits } from '@/lib/visitCrew';
import { getSupabase } from '@/lib/supabaseClient';
import { doubleBookedIds } from '@/lib/schedule';
import { fmtDateTime, fmtDuration, JOB_STATUS, JOB_TYPES, addressLine } from '@/lib/format';
import MapLink from '@/components/MapLink';
import PhoneInput from '@/components/PhoneInput';
import { hasFeature, serviceOf, serviceTitle, tabsFor, SERVICES, SERVICE_HINTS } from '@/lib/services';
import { displayPhone, telHref } from '@/lib/phone';
import { staffName, displayNameFor } from '@/lib/userDisplay';
import { apiFetch } from '@/lib/useAuth';
import { fetchJobPack, packKey } from '@/lib/jobPack';
import { sendVisitAction } from '@/lib/offlineActions';
import { getOps, onOpsFinished, onQueueChange } from '@/lib/offlineClient';
import { overlayVisits } from '@/lib/offlineOps';
import { cacheRead } from '@/lib/offlineClient';
import { savePackLocally } from '@/lib/warmJobs';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

// The Updates tab is shelved for now (job chat takes its place). Its code and data stay; flip this to bring the tab back.
const UPDATES_SHELVED = true;
const JOB_TABS = [
  ['overview', 'Overview'],
  ['details', 'Details'],
  ['photos', 'Photos'],
  ['sketch', 'Sketch'],
  ['moisture', 'Moisture'],
  ['inspection', 'Inspection'],
  ['evalsheet', 'Eval sheet'],
  ['updates', 'Updates'],
  ['thread', 'Chat'],
  ['estimate', 'Estimate'],
  ['invoice', 'Invoice'],
  ['costs', 'Costs'],
  ['reports', 'Reports'],
  ['history', 'History'],
];
// links and bookmarks made before the tabs were reworked (#customer was the first tab)
const OLD_TABS = { customer: 'overview' };
const tabFromHash = () => {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  const h = OLD_TABS[raw] || raw;
  return JOB_TABS.some(([k]) => k === h) ? h : 'overview';
};

// A missing table means migration 007 has not been run yet.
const missingTable = (err) => !!err && (err.code === '42P01' || /does not exist|schema cache|Could not find the table/i.test(err.message || ''));

const VISIT_STATUS = { scheduled: 'Scheduled', on_the_way: 'On the way', started: 'Started', finished: 'Finished', cancelled: 'Cancelled' };

// One camera for the whole job page. An "after" photo opens it with the "before" faintly over the live view.
function JobCamera({ camera, onClose, uploader, jobId, rooms }) {
  const urls = useSignedUrls(camera?.ghostPath ? [camera.ghostPath] : []);
  const ghost = camera?.ghostPath ? urls[camera.ghostPath] || null : null;
  return (
    <CameraCapture
      open={!!camera}
      onClose={onClose}
      uploader={uploader}
      jobId={jobId}
      rooms={rooms}
      defaultRoom={camera?.room || ''}
      pairOf={camera?.pairOf || null}
      ghostUrl={ghost}
      fixedKind={camera?.pairOf ? 'after' : null}
      closeAfterOne={!!camera?.pairOf}
    />
  );
}

function JobInner({ id, staff, token }) {
  const isOffice = staff.role !== 'tech';
  const chatRows = useChatCenter().rows;
  const chatDock = useChatDock();
  const mobile = useIsMobile(); // Quick Actions are for phone-sized screens only (under 900px, same as the bottom navigation)
  const [job, setJob] = useState(null);
  const [visits, setVisitsRaw] = useState([]);
  const [waitingOps, setWaitingOps] = useState([]);
  const setVisits = setVisitsRaw;
  const [flagged, setFlagged] = useState(new Set());
  const [contacts, setContacts] = useState([]);
  const [jobContactIds, setJobContactIds] = useState([]);
  const [inspLaunch, setInspLaunch] = useState(null); // { kind: 'pre' | 'post', n }: opens that inspection record by itself
  const [newContact, setNewContact] = useState(null); // inline 'add a contact' form on the Customer card
  const [events, setEvents] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [msg, setMsg] = useState(null);
  const jobSave = useSaveStatus();
  const [form, setForm] = useState(null);
  const [visitEdit, setVisitEdit] = useState(null); // visit object, or {} for new
  const [tabState, setTab] = useState('overview');
  const [sketchId, setSketchId] = useState(null); // the sketch both the Sketch and Moisture tabs have open
  const [photos, setPhotos] = useState([]);
  const [sketches, setSketches] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [docsMissing, setDocsMissing] = useState(false);
  const [fromPhone, setFromPhone] = useState(false); // showing the copy kept on this phone (no signal)
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewer, setViewer] = useState(null); // { ids, startId }
  const roomInput = useRef(null);
  const roomTarget = useRef(null);
  const [otwOpen, setOtwOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false); // the Quick Action Screen
  const [qaLanding, setQaLanding] = useState(false); // on a phone it is the landing page of a job, in place of the Overview tab
  // Quick Actions mode (phones): the job's home is the Quick Action Screen, and everything else is a screen opened from it.
  // Tapping the X on it turns the mode off for this visit to the job only; opening any job again lands on it.
  const qaModeRef = useRef(false);
  const setQaMode = (on) => { qaModeRef.current = on; };
  const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;
  useEffect(() => {
    if (!isPhone()) return;
    qaModeRef.current = true;
    const unit = new URLSearchParams(window.location.search).get('unit');
    if (!window.location.hash && !unit) { setQaLanding(true); setQaOpen(true); }
    else { qaFromRef.current = true; setQaFrom(true); } // a screen is already open (reload, scanned label): the way back to Quick Actions is there too
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [assignOpen, setAssignOpen] = useState(false);
  // widening a window past the phone breakpoint leaves Quick Actions behind
  useEffect(() => { if (!mobile) { setQaOpen(false); setQaLanding(false); } }, [mobile]);
  // one-shot requests from the phone's action button to a tab: { n } objects, cleared by the tab once it has acted
  const [moistCmd, setMoistCmd] = useState(null);
  const [updCmd, setUpdCmd] = useState(null);
  const [clockTick, setClockTick] = useState(0);        // bumped when the job clock changes (phone button or the clock card), so each re-reads it
  const [clockRunning, setClockRunning] = useState(false); // this person's job clock is running now
  const [gobacks, setGobacks] = useState({});            // visit id -> tech id, for visits added as a tech's go-back (office and owner only)

  // Screens opened from the Quick Action Screen exit back to it (back bar, or the phone's back gesture)
  const qaFromRef = useRef(false);
  const backToQaRef = useRef(null);
  const [qaFrom, setQaFrom] = useState(false);
  const [waterRows, setWaterRows] = useState([]);       // Day 1 steps recorded on this job (water losses)
  const [waterOk, setWaterOk] = useState(false);        // false until the table exists and was read: no gating before migration 051 is run
  const [dayOneStep, setDayOneStep] = useState(null);   // which Day 1 dialog is open
  const [dayOneMsg, setDayOneMsg] = useState('');
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeMsg, setCompleteMsg] = useState('');
  // a screen opened from Quick Actions hides the phone's top bar and bottom navigation (see quickactions.css)
  useEffect(() => {
    document.body.classList.toggle('qa-page', mobile && qaFrom && !qaOpen);
    return () => document.body.classList.remove('qa-page');
  }, [mobile, qaFrom, qaOpen]);
  // keep the open tab across refreshes and back/forward (#overview, #photos, #sketch ...)
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => {
      // the phone's back gesture from a screen opened on the Quick Action Screen returns to it
      if (!window.location.hash && qaFromRef.current) { backToQaRef.current?.(); return; }
      setTab(tabFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openTab = (k) => {
    if (qaModeRef.current && k === 'overview') { backToQaRef.current?.(); return; } // in Quick Actions mode the job's home is the Quick Action Screen
    if (qaModeRef.current && !qaFromRef.current) { qaFromRef.current = true; setQaFrom(true); } // any screen opened in the mode has the way back
    setTab(k);
    window.history.replaceState(null, '', `#${k}`);
  };
  // a scanned equipment label opens the job with ?unit=<id>: go to the Moisture tab and open that unit, once
  const scanUnit = useRef(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('unit'));
  useEffect(() => {
    if (!scanUnit.current) return;
    const unitId = scanUnit.current;
    scanUnit.current = null;
    setTab('moisture');
    window.history.replaceState(null, '', `${window.location.pathname}#moisture`);
    setMoistCmd({ type: 'unit', unitId, n: Date.now() });
  }, []);
  // a request left over for a tab that is no longer open is dropped
  useEffect(() => {
    if (tabState !== 'moisture') setMoistCmd(null);
    if (tabState !== 'updates') setUpdCmd(null);
  }, [tabState]);

  const loadWater = useCallback(async () => {
    const { data, error } = await getSupabase().from('job_water_steps').select('*').eq('job_id', id).order('created_at');
    if (error) { setWaterOk(false); return; }
    setWaterRows(data || []);
    setWaterOk(true);
  }, [id]);
  useEffect(() => { loadWater(); }, [loadWater]);

  // Shows a job pack (fresh from the server, or the copy kept on this phone).
  const applyPack = useCallback((pack, fromPhone) => {
    const j = pack.job;
    setJob(j);
    if (!j) return;
    setForm({
      status: j.status, service: j.service || '', po_number: j.po_number, loss_summary: j.loss_summary,
      customer_notes: j.customer_notes, internal_notes: j.internal_notes, warning: j.warning, billing_contact_id: j.billing_contact_id || '',
    });
    setDocsMissing(missingTable(pack.photos.error) || missingTable(pack.sketches.error) || missingTable(pack.updates.error));
    setPhotos(pack.photos.data || []);
    setSketches((pack.sketches.data || []).map(({ plan, updated_at, ...rest }) => rest)); // the list does not carry plans
    setUpdates(pack.updates.data || []);
    setVisits(pack.visits);
    setContacts(pack.contacts);
    setJobContactIds((pack.jobContacts || []).map((r) => r.contact_id));
    setEvents(pack.events);
    setStaffList(pack.staff);
    setFromPhone(!!fromPhone);
  }, []);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const pack = await fetchJobPack(sb, id, isOffice);
    if (pack.error) {
      // no signal: open the copy kept on this phone, if there is one
      const saved = await cacheRead(packKey(id));
      if (saved) { applyPack(saved, true); return; }
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    applyPack(pack, false);
    if (pack.job) {
      savePackLocally(id, pack); // also keeps each sketch's plan for opening offline
    }
    // Double-booking flags: compare this job's visits with the same techs' other visits
    const techIds = [...new Set((pack.visits || []).map((x) => x.tech_id).filter(Boolean))];
    if (isOffice && techIds.length) {
      const { data: others } = await sb.from('job_visits').select('id,tech_id,starts_at,ends_at,status').in('tech_id', techIds).in('status', ['scheduled', 'on_the_way', 'started']);
      const flaggedIds = doubleBookedIds(others || []);
      setFlagged(flaggedIds);
    }
  }, [id, isOffice, applyPack]);

  useEffect(() => { load(); }, [load]);
  // the moment the signal comes back, replace the phone's copy with the real thing
  useEffect(() => {
    const back = () => load();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [load]);

  // Refresh only the history, so edits being typed in the job details form are not wiped.
  const loadEvents = useCallback(async () => {
    const { data } = await getSupabase().from('job_events').select('*').eq('job_id', id).order('at', { ascending: false }).limit(50);
    setEvents(data || []);
  }, [id]);

  const reloadPhotos = useCallback(async () => {
    const { data } = await getSupabase().from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false });
    setPhotos(data || []);
  }, [id]);
  const reloadSketches = useCallback(async () => {
    const { data } = await getSupabase().from('job_sketches').select('id,name,sort_order,created_at').eq('job_id', id).order('sort_order').order('created_at');
    setSketches(data || []);
  }, [id]);
  const reloadUpdates = useCallback(async () => {
    const { data } = await getSupabase().from('job_updates').select('*').eq('job_id', id).order('created_at', { ascending: false });
    setUpdates(data || []);
    loadEvents();
  }, [id, loadEvents]);

  // is this person's job clock running? (the phone button reads Clock Out while it is, Clock In when it is stopped)
  const visitStatusKey = visits.map((v) => v.status).join(',');
  useEffect(() => {
    let alive = true;
    getSupabase().from('job_clock_sessions').select('id').eq('job_id', id).eq('staff_id', staff.id).is('ended_at', null).is('voided_at', null).limit(1)
      .then(({ data, error }) => { if (alive && !error) setClockRunning((data || []).length > 0); });
    return () => { alive = false; };
  }, [id, staff.id, clockTick, visitStatusKey]);
  // go-backs logged on this job's visits (a missing table just means migration 026 is not run yet)
  useEffect(() => {
    if (!isOffice) return undefined;
    let alive = true;
    getSupabase().from('job_gobacks').select('visit_id,tech_id').eq('job_id', id).is('voided_at', null)
      .then(({ data, error }) => { if (alive && !error) setGobacks(Object.fromEntries((data || []).filter((g) => g.visit_id).map((g) => [g.visit_id, g.tech_id]))); });
    return () => { alive = false; };
  }, [id, isOffice, visits]);

  const logEvent = useCallback(async (kind, details) => {
    await getSupabase().from('job_events').insert({ job_id: id, actor_id: staff.id, actor_email: staff.email, kind, details });
    loadEvents();
  }, [id, staff.id, staff.email, loadEvents]);

  const uploader = usePhotoUploader({ jobId: id, onUploaded: reloadPhotos, logEvent, photos });
  const rooms = useJobRooms(id, sketches.map((x) => x.id).join(','));
  const [camera, setCamera] = useState(null); // null = closed, otherwise options for the camera ({ ghost, pairOf, room })
  const openCamera = (opts = {}) => setCamera(opts);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { const o = await getOps(); if (!o) return; const l = await o.list(id); if (alive) setWaitingOps(l.filter((x) => x.type === 'visit_status')); };
    refresh();
    const off1 = onQueueChange(refresh);
    const off2 = onOpsFinished(() => { refresh(); load(); });
    return () => { alive = false; off1(); off2(); };
  }, [id, load]);
  const visitsShown = useMemo(() => overlayVisits(visits, waitingOps), [visits, waitingOps]);
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  if (loadFailed && !job) {
    return (
      <div className="card">
        <h2>This job is not available offline</h2>
        <p className="hint">There is no signal, and this job was not opened on this phone before. Pictures you take are not lost: open the job once while you have signal and it will be saved here. Anything already waiting to upload is listed under <Link href="/queue">Waiting to upload</Link>.</p>
        <button className="secondary" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!job || !form) return <p className="muted">Loading job...</p>;

  // What this kind of job shows. A tab the service does not have falls back to Overview (its data stays saved).
  const service = serviceOf(job);
  const shownTabs = tabsFor(JOB_TABS, service, { customerType: job.customer?.customer_type }).filter(([k]) => k !== 'costs' || staff.role === 'owner').filter(([k]) => !(UPDATES_SHELVED && k === 'updates')); // job costs are for the owner alone
  const tab = shownTabs.some(([k]) => k === tabState) ? tabState : 'overview';
  // Water losses: Day 1 steps, and Finish visit is not Complete job
  const restoration = usesDayOneSteps(service, job.job_type);
  const dayOneOn = restoration && waterOk;
  const activeVisitCount = visits.filter((v) => ['scheduled', 'on_the_way', 'started'].includes(v.status)).length;
  const canCompleteNow = restoration && visits.some((v) => v.status === 'finished') && canCompleteJob({ jobStatus: job.status, activeVisits: activeVisitCount }).ok && (isOffice || visits.some((v) => v.tech_id === staff.id));
  const equipGate = dayOneOn ? gateFor('equipment', waterRows) : null;
  const openDayOne = (step, msg = '') => { setDayOneMsg(msg); setDayOneStep(step === 'next' ? (nextDayOneStep(waterRows)?.step || 'safety') : step); };
  async function completeJob() {
    if (!window.confirm('Complete this job? This makes the invoice draft.')) return;
    setCompleteBusy(true); setCompleteMsg('');
    try { await apiFetch(`/api/jobs/${id}/complete`, token, { method: 'POST', body: JSON.stringify({}) }); await load(); }
    catch (e) { setCompleteMsg(e.message); }
    setCompleteBusy(false);
  }
  // a finished job should have all its equipment picked up
  const shortCount = ['completed', 'closed'].includes(job.status) ? sketches.flatMap((sk) => unitsStillOnSite(normalizePlan(sk.plan))) : [];

  const openViewer = (list, startId) => setViewer({ ids: list.map((p) => p.id), startId });
  const viewerList = viewer ? viewer.ids.map((i) => photosById.get(i)).filter(Boolean) : [];
  const authorName = (uid) => {
    const s = staffList.find((x) => x.id === uid);
    return s ? staffName(s) : '';
  };
  function addRoomPhoto(sketchId, room) {
    roomTarget.current = { sketchId, roomKey: room.id };
    roomInput.current?.click();
  }

  const name = (uid) => {
    const s = staffList.find((x) => x.id === uid);
    return s ? staffName(s) : 'Unassigned';
  };
  // Who did it, by name. Falls back to a tidied email for people no longer in the active list.
  const actorName = (e, none) => {
    const s = staffList.find((x) => x.id === e.actor_id);
    if (s) return staffName(s);
    return e.actor_email ? displayNameFor(null, e.actor_email) : none;
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function saveJob(e) {
    e.preventDefault();
    setMsg(null);
    const patch = { ...form, service: form.service || null, billing_contact_id: form.billing_contact_id || null };
    if (patch.status === 'completed' && job.status !== 'completed') patch.completed_at = new Date().toISOString();
    const { error } = await getSupabase().from('jobs').update(patch).eq('id', id);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    const changed = {};
    for (const k of Object.keys(form)) {
      const before = k === 'billing_contact_id' || k === 'service' ? job[k] || '' : job[k];
      if (before !== form[k]) changed[k] = { from: before, to: form[k] };
    }
    if (Object.keys(changed).length) await logEvent(changed.status ? 'status' : 'edited', changed);
    setMsg({ text: 'Saved.' });
    load();
    return true;
  }

  async function toggleContact(cid) {
    const sb = getSupabase();
    if (jobContactIds.includes(cid)) await sb.from('job_contacts').delete().eq('job_id', id).eq('contact_id', cid);
    else await sb.from('job_contacts').insert({ job_id: id, contact_id: cid });
    await logEvent('contact_' + (jobContactIds.includes(cid) ? 'removed' : 'added'), { contact_id: cid });
    load();
  }

  // Creates a new contact on the customer and adds it to this job's notifications in one step.
  async function addContact(e) {
    e.preventDefault();
    const name = newContact.name.trim();
    if (!name) return;
    if (!newContact.phone && !newContact.email) { setMsg({ err: true, text: 'Add a phone number or an email so there is a way to notify them.' }); return; }
    const sb = getSupabase();
    const { data: created, error } = await sb.from('contacts')
      .insert({ customer_id: job.customer.id, name, role: newContact.role.trim(), phone: newContact.phone, email: newContact.email.trim(), receives_notifications: true })
      .select('id').single();
    if (error) { setMsg({ err: true, text: error.message }); return; }
    const { error: linkErr } = await sb.from('job_contacts').insert({ job_id: id, contact_id: created.id });
    if (linkErr) { setMsg({ err: true, text: linkErr.message }); load(); return; }
    await logEvent('contact_added', { contact_id: created.id, name });
    setMsg(null);
    setNewContact(null);
    load();
  }

  // Cancel a visit; for a crew, every member who has not started goes with it.
  async function cancelVisit(v) {
    const crew = v.crew_id ? visits.filter((x) => x.crew_id === v.crew_id && x.status === 'scheduled') : [v];
    if (!window.confirm(crew.length > 1 ? `Cancel this visit for all ${crew.length} team members?` : 'Cancel this visit?')) return;
    await getSupabase().from('job_visits').update({ status: 'cancelled' }).in('id', crew.map((x) => x.id));
    await logEvent('visit_cancelled', { visit_id: v.id, ...(crew.length > 1 ? { crew: crew.map((x) => x.tech_id).filter(Boolean) } : {}) });
    load();
  }

  // the address warning (pets) shows in the Site card; only the job-level warning stays a banner
  const warnings = [job.warning].filter(Boolean);
  // the visit "On the way" applies to: the next one still waiting, if this person may act on it
  const otwVisit = visitsShown.find((v) => ['scheduled', 'on_the_way'].includes(v.status) && (isOffice || v.tech_id === staff.id));
  // a visit still waiting with nobody on it: the office sees a red Assign Job button
  const unassignedVisit = isOffice ? visits.find((v) => v.status === 'scheduled' && !v.tech_id) : null;
  // the phone's action bar follows the visit under way, otherwise the next one waiting
  const dockVisit = visitsShown.find((v) => v.status === 'started' && (isOffice || v.tech_id === staff.id)) || otwVisit;
  // phone action button: Start Recheck / Start Sketch / Start Job, which becomes Complete Job once the visit is under way
  // job clock for the phone button: Clock Out while this person's clock runs, Clock In when their visit is under way and it is stopped
  const myVisitStarted = visitsShown.some((v) => v.status === 'started' && v.tech_id === staff.id);
  const clockMode = ['closed', 'cancelled'].includes(job.status) ? null : clockRunning ? 'out' : myVisitStarted ? 'in' : null;
  // Start job is only for the team member the visit is assigned to (office and owner can still send On the way)
  const canStart = !!dockVisit && dockVisit.tech_id === staff.id;
  const fabKeys = FAB_HIDDEN_TABS.includes(tab) ? [] : fabActions({ hasSketch: sketches.length > 0, visitStatus: dockVisit?.status || null, docsMissing, recheck: hasFeature(service, 'recheck'), chat: true, clock: clockMode, canStart }).filter((k) => !(UPDATES_SHELVED && (k === 'complete' || k === 'internal'))); // those two write an Updates note
  // Carpet jobs: Start opens the before-cleaning record, Finish opens the after-cleaning record.
  const canDoc = hasFeature(service, 'inspectionTab') && !['closed', 'cancelled'].includes(job.status);
  const onVisitAction = (action) => {
    if (!canDoc) return;
    if (action === 'started' || action === 'finished') {
      openTab('inspection');
      setInspLaunch({ kind: action === 'started' ? 'pre' : 'post', n: Date.now() });
    }
  };
  const fabRun = {
    chat: () => chatDock.openJob(id, `Job #${job.job_number}`),
    photos: () => openCamera(),
    recheck: () => { openTab('moisture'); setMoistCmd({ type: 'recheck', n: Date.now() }); },
    sketch: () => openTab('sketch'),
    otw: () => setOtwOpen(true),
    start: async () => {
      const r = await sendVisitAction({ visit: dockVisit, action: 'started', jobId: id });
      await load();
      if (!r?.queued) onVisitAction('started');
    },
    clock_out: async () => { await apiFetch(`/api/jobs/${id}/clock`, token, { method: 'POST', body: JSON.stringify({ action: 'out' }) }); setClockTick((n) => n + 1); },
    clock_in: async () => { await apiFetch(`/api/jobs/${id}/clock`, token, { method: 'POST', body: JSON.stringify({ action: 'in' }) }); setClockTick((n) => n + 1); },
    finish: async () => {
      if (!window.confirm(restoration ? 'Finish this visit?' : 'Finish this job?')) return;
      const r = await sendVisitAction({ visit: dockVisit, action: 'finished', jobId: id });
      await load();
      if (!r?.queued) onVisitAction('finished');
    },
    dayone: () => openDayOne('next'),
    complete_job: () => completeJob(),
    complete: () => { openTab('updates'); setUpdCmd({ kind: 'internal', category: 'Completed Job', n: Date.now() }); },
    internal: () => { openTab('updates'); setUpdCmd({ kind: 'internal', category: INTERNAL_CATEGORIES[0], n: Date.now() }); },
  };
  const jobChatUnread = countForTarget(chatRows, { jobId: id });
  // Quick Action Screen: tab actions open that tab; the rest use the same handlers as the phone button
  const enterFromQa = (tabKey) => { qaFromRef.current = true; setQaFrom(true); window.history.pushState(null, '', `#${tabKey}`); };
  const backToQa = () => {
    qaFromRef.current = false;
    setQaFrom(false);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setTab('overview');
    setQaLanding(window.matchMedia('(max-width: 899px)').matches);
    setQaOpen(true);
  };
  backToQaRef.current = backToQa;
  // Exit leaves Quick Actions for this visit to the job and lands on the normal Overview
  const exitQa = () => {
    setQaMode(false); qaFromRef.current = false; setQaFrom(false); setQaOpen(false); setQaLanding(false); setTab('overview');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  // a screen opened from Quick Actions is its own page: Back arrow and Exit only, no breadcrumb, header or tabs
  const qaScreen = mobile && qaFrom && !qaOpen;
  const qaRun = (key) => {
    if (key === 'eta') return fabRun.otw();
    if (key === 'recheck') { enterFromQa('moisture'); return fabRun.recheck(); }
    if (isTabAction(key)) { enterFromQa(key); openTab(key); return undefined; }
    return fabRun[key]?.();
  };
  const fabItems = fabKeys.map((key) => ({ key, badge: key === 'chat' ? jobChatUnread : 0, label: key === 'otw' && dockVisit?.status === 'on_the_way' ? 'Update ETA' : FAB_LABELS[key], onClick: fabRun[key] }));
  const contactName = [job.customer.first_name, job.customer.last_name].filter(Boolean).join(' ').trim();
  const anyFlag = visits.some((v) => flagged.has(v.id) && v.status !== 'cancelled');

  return (
    <>
      {qaScreen
        ? <QaPageBar title={qaScreenTitle(tab, shownTabs.find(([k]) => k === tab)?.[1])} jobNumber={job.job_number} onBack={backToQa} onExit={exitQa} />
        : <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Jobs', href: '/jobs' }, { label: `Job #${job.job_number}` }]} />}
      {!qaScreen && <div className="page-head job-head">
        <div className="job-head-main">
          <h1>Job #{job.job_number} <span className={`badge s-${job.status}`}>{JOB_STATUS[job.status]}</span></h1>
          <p className="sub">
            {isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}
            {' · '}{serviceTitle(service) || JOB_TYPES[job.job_type]}
            {isOffice && job.lead_id && <>{' · '}<Link href={`/leads/${job.lead_id}`}>From lead</Link></>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {unassignedVisit && <button type="button" className="assign-btn" onClick={() => setAssignOpen(true)}>Assign Job</button>}
          {otwVisit && <button type="button" className="primary desktop-only" onClick={() => setOtwOpen(true)}>On the way</button>}
        </div>
      </div>}
      <AssignJobModal open={assignOpen} visit={unassignedVisit} staffList={staffList} onClose={() => setAssignOpen(false)} onDone={load} logEvent={logEvent} />
      {otwVisit && <OnTheWayModal open={otwOpen} visit={otwVisit} token={token} onClose={() => setOtwOpen(false)} onDone={load} />}
      {!qaScreen && !isOffice && !visits.some((v) => v.tech_id === staff.id) && <p className="hint" style={{ marginTop: 0 }}>This job is not on your schedule. It is open to you from the Jobs list in case you need it.</p>}

      {!qaScreen && warnings.map((w, i) => <div key={i} className="banner">Warning: {w}</div>)}
      {!qaScreen && anyFlag && <div className="banner flag">Double-booked: one of this job's visits overlaps another visit for the same tech. Move one of them.</div>}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      {!qaScreen && docsMissing && (
        <div className="banner">Photos, sketches and updates are switched off until migration 007 is run in Supabase (SQL Editor, file supabase/migrations/007_job_documentation.sql).</div>
      )}

      {fromPhone && (
        <div className="msg err" role="status">You are looking at a copy saved on this phone (no signal). Photos, notes and sketch changes you make are kept and sent when you have signal. Visit and status buttons need a connection.</div>
      )}
      {!qaScreen && shortCount.length > 0 && (
        <div className="msg err" role="alert">
          <strong>{shortCount.length} piece{shortCount.length === 1 ? '' : 's'} of equipment {shortCount.length === 1 ? 'is' : 'are'} still marked on site</strong> ({shortCount.slice(0, 8).join(', ')}{shortCount.length > 8 ? ', ...' : ''}). Pick {shortCount.length === 1 ? 'it' : 'them'} up on the {hasFeature(service, 'moistureTab') ? 'Moisture' : 'Sketch'} tab, or {shortCount.length === 1 ? 'it' : 'they'} stay on the count.
          {' '}<button type="button" className="secondary small" onClick={() => openTab(hasFeature(service, 'moistureTab') ? 'moisture' : 'sketch')}>Open {hasFeature(service, 'moistureTab') ? 'Moisture' : 'Sketch'}</button>
        </div>
      )}
      {!qaScreen && <div className="tabs" role="tablist">
        {shownTabs.map(([k, label]) => {
          const n = k === 'photos' ? photos.filter((p) => !p.archived_at).length : k === 'sketch' ? sketches.length : k === 'updates' ? updates.length : k === 'thread' ? countForTarget(chatRows, { jobId: id }) : 0;
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>
              {label}{n > 0 && <span className="tab-count">{n}</span>}
            </button>
          );
        })}
      </div>}

      {mobile && tab === 'overview' && <button type="button" className="primary qa-open-btn" onClick={() => { setQaMode(true); setQaLanding(true); setQaOpen(true); }}>Quick actions</button>}
      {mobile && <QuickActionScreen
        open={qaOpen} landing={qaLanding} onClose={() => { setQaOpen(false); setQaLanding(false); }} onExit={exitQa} job={job} customerName={job.customer.display_name}
        visitStatus={dockVisit?.status || null} canStart={canStart} clock={clockMode} service={service} tabs={shownTabs.map(([k]) => k)}
        hasSketch={sketches.length > 0} run={qaRun} badges={{ chat: jobChatUnread }} dayOne={dayOneOn} restoration={restoration} canComplete={canCompleteNow}
      />}

      {tab === 'overview' && dockVisit && <VisitDock inline visit={dockVisit} staffId={staff.id} token={token} onOtw={() => setOtwOpen(true)} onDone={load} onAction={onVisitAction} restoration={restoration} />}

      {tab === 'overview' && dayOneOn && <DayOneCard rows={waterRows} onOpen={openDayOne} canComplete={canCompleteNow} onComplete={completeJob} completeBusy={completeBusy} completeMsg={completeMsg} />}
      {dayOneOn && dayOneStep && <WaterDayOne step={dayOneStep} message={dayOneMsg} onClose={() => setDayOneStep(null)} jobId={id} staff={staff} customerName={contactName || job.customer.display_name} rows={waterRows} photoCount={photos.filter((x) => !x.archived_at).length} onReload={loadWater} />}

      {tab === 'overview' && (
        <div className="job-overview">
          <div className="ov-top">
            <div className="card ov-customer">
              <div className="card-head">
                <h2>Customer</h2>
                {isOffice && !newContact && <button type="button" className="secondary small" onClick={() => setNewContact({ name: '', role: '', phone: '', email: '' })}>Add contact</button>}
              </div>
              <div className="title">{isOffice ? <Link href={`/customers/${job.customer.id}`}>{job.customer.display_name}</Link> : job.customer.display_name}</div>
              {contactName && contactName !== job.customer.display_name && <div>{contactName}</div>}
              <div className="contact-chips">
                {job.customer.phone && <a className="chip-link" href={telHref(job.customer.phone)}>Call {displayPhone(job.customer.phone)}</a>}
                {job.customer.email && <a className="chip-link" href={`mailto:${job.customer.email}`}>{job.customer.email}</a>}
                {!job.customer.phone && !job.customer.email && <span className="muted">No phone or email on file.</span>}
              </div>
              {isOffice && newContact && (
                <form onSubmit={addContact} className="customer-contacts" style={{ marginTop: 10 }}>
                  <div className="grid2">
                    <div className="field"><label>Name</label><input required autoFocus value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} /></div>
                    <div className="field"><label>Role</label><input placeholder="Adjuster, manager, tenant..." value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} /></div>
                    <div className="field"><label>Phone</label><PhoneInput value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} /></div>
                    <div className="field"><label>Email</label><input type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} /></div>
                  </div>
                  <div className="row">
                    <button className="primary">Add and notify</button>
                    <button type="button" className="secondary" onClick={() => setNewContact(null)}>Cancel</button>
                  </div>
                </form>
              )}
              {isOffice && (
                <div className="also-notify">
                  <h3>Also notify</h3>
                  {contacts.length > 0 && <p className="hint">Ticked contacts get this job's progress updates.</p>}
                  {contacts.map((c) => (
                    <label key={c.id} className="also-notify-row">
                      <input type="checkbox" checked={jobContactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                      <span>{c.name} {c.role && <span className="badge off">{c.role}</span>} <span className="muted">{[displayPhone(c.phone), c.email].filter(Boolean).join(' · ')}</span></span>
                    </label>
                  ))}
                  {contacts.length === 0 && <p className="muted" style={{ margin: 0 }}>No extra contacts yet.</p>}
                </div>
              )}
            </div>

            <div className="ov-side">
              <div className="card">
                <h2>Site</h2>
                <div className="title"><MapLink address={job.address} /></div>
                {job.address.gate_code &&<div>Gate code: <strong>{job.address.gate_code}</strong></div>}
                {job.address.warnings && <div>Pets: <strong>{job.address.warnings}</strong></div>}
                {job.address.access_notes && <div className="meta">{job.address.access_notes}</div>}
              </div>

              {job.loss_summary && (
                <div className="card">
                  <h2>Loss summary</h2>
                  <div>{job.loss_summary}</div>
                </div>
              )}
            </div>
          </div>

          <ClockCard jobId={id} staff={staff} staffList={staffList} token={token} service={service} jobStatus={job.status} refreshKey={`${visitStatusKey}|${clockTick}`} onChanged={() => setClockTick((n) => n + 1)} />

          <div className="card wide">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2>Visits</h2>
              {isOffice && <button className="secondary small" onClick={() => setVisitEdit({})}>Add visit</button>}
            </div>
            {groupVisits(visitsShown).map((g) => {
              const v = g.lead;
              const canEditGroup = isOffice && g.members.some((m) => m.status === 'scheduled');
              const editRow = g.members.find((m) => m.status === 'scheduled') || v;
              return (
                <div key={g.key} className="visit-row">
                  <div className="visit-main">
                    <div className="title">
                      {fmtDateTime(v.starts_at)} for {fmtDuration(v.duration_minutes)}{' '}
                      {g.solo && <span className="badge off">{VISIT_STATUS[v.status]}</span>}
                      {g.members.some((m) => flagged.has(m.id) && m.status !== 'cancelled') && <> <span className="badge warn">Double-booked</span></>}
                    </div>
                    {g.solo
                      ? <div className="meta">{name(v.tech_id)}{v.minutes_out ? ` · ${v.minutes_out} min out` : ''}</div>
                      : g.members.map((m) => (
                        <div key={m.id} className="visit-member">
                          <span>{name(m.tech_id)}{m.minutes_out ? ` · ${m.minutes_out} min out` : ''}</span>
                          <span className="badge off">{VISIT_STATUS[m.status]}</span>
                          {(isOffice || m.tech_id === staff.id) && <VisitActions visit={m} staffId={staff.id} token={token} onDone={load} onAction={onVisitAction} restoration={restoration} />}
                        </div>
                      ))}
                    {reasonText(v) && <div className="meta">Reason: {reasonText(v)}{isOffice && gobacks[v.id] && <> <span className="badge warn">Go-back: {name(gobacks[v.id])}</span></>}</div>}
                  </div>
                  <div className="visit-buttons">
                    {g.solo && (isOffice || v.tech_id === staff.id) && <VisitActions visit={v} staffId={staff.id} token={token} onDone={load} onAction={onVisitAction} restoration={restoration} />}
                    {canEditGroup && (
                      <>
                        <button className="secondary small" onClick={() => setVisitEdit(editRow)}>Reschedule</button>
                        <button className="linklike danger-link" onClick={() => cancelVisit(editRow)}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {visitsShown.length === 0 && <p className="muted">No visits scheduled.</p>}
          </div>

          {isOffice && hasFeature(service, 'customerPage') && <CustomerPageCard jobId={id} token={token} staff={staff} jobStatus={job.status} />}
          {isOffice && ['completed', 'closed'].includes(job.status) && <StreetOffersCard jobId={id} token={token} />}
          {staff.role === 'owner' && <DeleteJobCard jobId={id} job={job} token={token} />}
        </div>
      )}

      {tab === 'details' && (
        <>
      {isOffice ? (
        <form className="card" onSubmit={jobSave.track(saveJob)}>
          <h2>Job details</h2>
          <div className="grid2">
            <div className="field"><label>Status</label>
              <select value={form.status} onChange={set('status')}>
                {Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label>Service</label>
              <select value={form.service} onChange={set('service')}>
                <option value="">Not set (shows every tool)</option>
                {Object.entries(SERVICES).map(([k, v]) => <option key={k} value={k}>{v} · {SERVICE_HINTS[k]}</option>)}
              </select>
              <div className="note">Decides which tabs and tools this job shows. Anything already saved on the job stays saved if you change it.</div>
            </div>
            <div className="field"><label>PO number</label><input value={form.po_number} onChange={set('po_number')} /></div>
            <div className="field"><label>Billing contact</label>
              <select value={form.billing_contact_id} onChange={set('billing_contact_id')}>
                <option value="">Customer ({job.customer.display_name})</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Loss summary for the tech</label><input value={form.loss_summary} onChange={set('loss_summary')} /></div>
          <div className="field"><label>Job warning (banner)</label><input value={form.warning} onChange={set('warning')} /></div>
          <div className="field"><label>Customer-facing notes</label><textarea value={form.customer_notes} onChange={set('customer_notes')} /><div className="note">May appear on estimates and invoices.</div></div>
          <div className="field"><label>Internal notes</label><textarea value={form.internal_notes} onChange={set('internal_notes')} /><div className="note">Never shown to the customer. For dated notes with photos, use the Updates tab.</div></div>
          <SaveButton save={jobSave} idle="Save job" className="primary" />
        </form>
      ) : (
        <div className="card">
          <h2>Notes</h2>
          {job.po_number && <p>PO: {job.po_number}</p>}
          {job.loss_summary && <p><strong>Loss summary:</strong> {job.loss_summary}</p>}
          <p><strong>Customer notes:</strong> {job.customer_notes || 'None'}</p>
          <p><strong>Internal notes:</strong> {job.internal_notes || 'None'}</p>
        </div>
      )}
        </>
      )}

      {tab === 'photos' && (
        <PhotosTab
          photos={photos}
          isOffice={isOffice}
          uploader={uploader}
          onOpen={openViewer}
          jobId={id}
          rooms={rooms}
          authorName={authorName}
          staffId={staff.id}
          updates={updates}
          onTakePhoto={() => openCamera()}
          onChanged={reloadPhotos}
          logEvent={logEvent}
        />
      )}

      {tab === 'sketch' && (
        <>
          <UploadStatus uploader={uploader} />
          <SketchTab
            jobId={id}
            sketches={sketches}
            photos={photos}
            isOffice={isOffice}
            staff={staff}
            staffList={staffList}
            logEvent={logEvent}
            onReload={reloadSketches}
            onAddRoomPhoto={addRoomPhoto}
            onViewPhotos={(list) => list.length && openViewer(list, list[0].id)}
            startId={sketchId}
            onActive={setSketchId}
            service={service}
            onOpenMoisture={hasFeature(service, 'moveToMoisture') ? () => openTab('moisture') : undefined}
          />
        </>
      )}

      {tab === 'moisture' && (
        <>
        <UploadStatus uploader={uploader} />
        <MoistureTab
          sketches={sketches}
          startId={sketchId}
          onActive={setSketchId}
          staff={staff}
          staffList={staffList}
          onOpenSketch={() => openTab('sketch')}
          jobId={id}
          isOffice={isOffice}
          jobStandards={job.dry_standards}
          onJobStandards={(std) => setJob((j) => (j ? { ...j, dry_standards: std } : j))}
          jobInfo={{ jobId: id, customer: job.customer.display_name, address: addressLine(job.address), jobNumber: job.job_number, jobType: serviceTitle(service) || JOB_TYPES[job.job_type] }}
          photos={photos}
          onAddPhoto={addRoomPhoto}
          onViewPhotos={(list) => list.length && openViewer(list, list[0].id)}
          command={moistCmd}
          onCommandDone={() => setMoistCmd(null)}
          equipGate={equipGate}
          onEquipBlocked={(g) => openDayOne(g.step, g.reason)}
        />
        </>
      )}

      {tab === 'inspection' && (
        <InspectionTab customerName={contactName || job.customer.display_name} jobId={id} staff={staff} sketches={sketches} photos={photos} uploader={uploader} onOpenPhotos={openViewer} canEdit={!['closed', 'cancelled'].includes(job.status)} launch={inspLaunch} />
      )}

      {tab === 'evalsheet' && (
        <EvalSheetTab jobId={id} job={job} staff={staff} photos={photos} uploader={uploader} onOpenPhotos={openViewer} canEdit={!['closed', 'cancelled'].includes(job.status)} />
      )}

      {tab === 'updates' && (
        <UpdatesTab
          service={service}
          jobId={id}
          updates={updates}
          photos={photos}
          isOffice={isOffice}
          staff={staff}
          token={token}
          authorName={authorName}
          logEvent={logEvent}
          onReload={reloadUpdates}
          uploader={uploader}
          onOpenPhotos={openViewer}
          recipients={updateRecipients(
            { name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email },
            contacts.filter((c) => jobContactIds.includes(c.id)),
          )}
          baseUrl={typeof window === 'undefined' ? '' : window.location.origin}
          command={updCmd}
          onCommandDone={() => setUpdCmd(null)}
        />
      )}

      {tab === 'thread' && <ThreadPanel kind="job" refId={id} staff={staff} fill />}

      {tab === 'reports' && (
        <ReportsTab
          jobId={id}
          service={service}
          photos={photos}
          rooms={rooms}
          sketches={sketches}
          isOffice={isOffice}
          isOwner={staff.role === 'owner'}
          jobStandards={job.dry_standards}
          info={{ jobId: id, customer: job.customer.display_name, address: addressLine(job.address), jobNumber: job.job_number, jobType: serviceTitle(service) || JOB_TYPES[job.job_type] }}
        />
      )}

      {tab === 'estimate' && (
        <>
      <EstimateCard
        service={service}
        scope={{ jobId: id }}
        open={!['closed', 'cancelled'].includes(job.status)}
        staff={staff}
        token={token}
        contact={{ name: job.customer.display_name, phone: job.customer.phone, email: job.customer.email }}
        onChanged={loadEvents}
      />
        </>
      )}

      {tab === 'invoice' && (
        <InvoiceTab jobId={id} job={job} photos={photos} staff={staff} token={token} isOffice={isOffice} onChanged={loadEvents} />
      )}

      {tab === 'costs' && staff.role === 'owner' && (
        <CostsTab jobId={id} sketches={sketches} staffList={staffList} />
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>History</h2>
          {events.map((e) => (
            <div key={e.id} className="list-item">
              <div className="title">{eventLabel(e)}</div>
              <div className="meta">{fmtDateTime(e.at)} · {actorName(e, 'system')}</div>
            </div>
          ))}
          {events.length === 0 && <p className="muted">No history yet.</p>}
        </div>
      )}

      <PopupModal open={isOffice && !!visitEdit} onClose={() => setVisitEdit(null)} title={visitEdit?.id ? 'Reschedule visit' : 'Add visit'} wide closeOnOverlay={false}>
        {visitEdit && (
          <VisitForm
            jobId={id}
            visit={visitEdit.id ? visitEdit : null}
            visits={visits}
            service={service}
            staffList={staffList}
            staff={staff}
            onDone={() => { setVisitEdit(null); load(); }}
            onCancel={() => setVisitEdit(null)}
            logEvent={logEvent}
          />
        )}
      </PopupModal>

      {!qaOpen && !qaScreen && <JobFab items={fabItems} />}

      <input
        ref={roomInput}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          const t = roomTarget.current;
          if (files.length && t) uploader.upload(files, { kind: 'during', sketchId: t.sketchId, roomKey: t.roomKey });
        }}
      />

      <JobCamera camera={camera} onClose={() => setCamera(null)} uploader={uploader} jobId={id} rooms={rooms} />

      {viewer && viewerList.length > 0 && (
        <PhotoViewer
          list={viewerList}
          startId={viewer.startId}
          jobId={id}
          fileBase={`job-${job.job_number}`}
          authorName={authorName}
          logEvent={logEvent}
          onChanged={reloadPhotos}
          rooms={rooms}
          allPhotos={photos}
          token={token}
          isOffice={isOffice}
          onTakeAfter={(p) => { setViewer(null); openCamera({ pairOf: p.id, ghostPath: p.thumb_path || p.storage_path, room: p.sketch_id && p.room_key ? `${p.sketch_id}|${p.room_key}` : '' }); }}
          onAppend={(newId, afterId) => setViewer((v) => {
            if (!v) return v;
            const at = v.ids.indexOf(afterId);
            const ids = [...v.ids];
            ids.splice(at < 0 ? ids.length : at + 1, 0, newId);
            return { ...v, ids };
          })}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

export default function JobPage() {
  const { id } = useParams();
  return <AuthGate>{({ staff, token }) => <JobInner id={id} staff={staff} token={token} />}</AuthGate>;
}
