'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { backupAction, clearAside, clearBackup, readAside, readBackup, scheduleBackup, setAside } from '@/lib/sketchBackup';
import { cacheRead, cacheWrite } from '@/lib/offlineClient';
import { isNetworkError } from '@/lib/jobPack';
import { normalizePlan, roomPhotoCounts } from '@/lib/sketch';
import { sameStandards, withJobStandards } from '@/lib/moisture';
import FloorCanvas from '@/components/job/FloorCanvas';
import AdjusterLink from '@/components/job/AdjusterLink';
import { assetChanges, assetTag, assetUsage } from '@/lib/assets';
import { unitAt } from '@/lib/equipment';

const SAVE_DELAY_MS = 1200;

// Moisture tab: the sketch as a plain floorplan with a layer per affected area. Tap to place a reading point,
// tap a pin to log a recheck. Points live in the sketch's plan, so they save the same way the sketch does.
export default function MoistureTab({ sketches, startId = null, onActive, staff = null, staffList = [], onOpenSketch, command = null, onCommandDone = null, photos = [], onAddPhoto = null, onViewPhotos = null, jobInfo = null, jobId = null, isOffice = false, jobStandards = null, onJobStandards = null , equipGate = null, onEquipBlocked = null }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [biz, setBiz] = useState(null); // the company's name and contact line for the report header
  const [activeId, setActiveId] = useState(startId);
  const [loaded, setLoaded] = useState(null); // { id, name, plan }
  const [loadErr, setLoadErr] = useState('');
  const [notice, setNotice] = useState(''); // what happened to a copy kept on this device
  const [asideCopy, setAsideCopy] = useState(false); // a copy that could not be restored is kept on this device
  const [save, setSave] = useState({ state: 'idle', text: '' });
  const [headSlot, setHeadSlot] = useState(null);
  const [inv, setInv] = useState(null); // the company equipment inventory (null until read, or when it is not set up)
  const invRef = useRef([]);
  const prefixRef = useRef('EQ');

  useEffect(() => {
    let live = true;
    getSupabase().from('settings').select('business_name,phone,email').eq('id', 1).maybeSingle().then(({ data }) => {
      if (live && data) setBiz({ business: data.business_name || '', phone: data.phone || '', email: data.email || '' });
    });
    return () => { live = false; };
  }, []);

  const loadInventory = useCallback(async () => {
    const sb = getSupabase();
    const [{ data, error }, { data: s }] = await Promise.all([
      sb.from('equipment_assets').select('id,asset_no,type,label,ppd,status,job_id,unit_id').neq('status', 'retired').order('asset_no'),
      sb.from('settings').select('asset_prefix').eq('id', 1).maybeSingle(),
    ]);
    if (error || !data) return; // migration 014 not run yet: the picker stays hidden
    prefixRef.current = s?.asset_prefix || 'EQ';
    invRef.current = data;
    setInv(data);
  }, []);
  useEffect(() => { loadInventory(); }, [loadInventory]);

  // Keep the inventory in step with the plan: machines on site here are "on a job", machines picked up are available again.
  const syncAssets = useCallback(async (plan) => {
    if (!jobId || !plan || !invRef.current.length) return;
    const sb = getSupabase();
    const mine = new Set((plan.equipment || []).map((u) => u.id));
    const usage = assetUsage(plan, unitAt);
    const known = invRef.current.filter((a) => a.job_id === jobId && mine.has(a.unit_id));
    const { claim, release } = assetChanges(usage, known, jobId);
    let changed = false;
    for (const c of claim) {
      const cur = invRef.current.find((a) => a.id === c.id);
      if (!cur || (cur.status === 'on_job' && cur.job_id === jobId && cur.unit_id === c.unitId)) continue;
      if (cur.status === 'repair' || (cur.status === 'on_job' && cur.job_id && cur.job_id !== jobId)) continue; // never take a machine that is out for repair or on another job
      const { error } = await sb.from('equipment_assets').update({ status: 'on_job', job_id: jobId, unit_id: c.unitId }).eq('id', c.id);
      if (!error) changed = true;
    }
    if (release.length) {
      const { error } = await sb.from('equipment_assets').update({ status: 'available', job_id: null, unit_id: null }).in('id', release).eq('job_id', jobId);
      if (!error) changed = true;
    }
    if (changed) loadInventory();
  }, [jobId, loadInventory]);

  // Dry standards are kept on the job, so every sketch of the job uses the same ones.
  const jobStdRef = useRef(jobStandards || {});
  useEffect(() => { jobStdRef.current = jobStandards || {}; }, [jobStandards]);
  const saveJobStandards = useCallback(async (std) => {
    if (!jobId || sameStandards(std, jobStdRef.current)) return;
    const { error } = await getSupabase().rpc('set_job_dry_standards', { p_job: jobId, p_standards: std });
    if (error) return; // migration 021 not run yet, or no signal: the sketch still keeps its own copy
    jobStdRef.current = std;
    onJobStandards?.(std);
  }, [jobId, onJobStandards]);

  const stamps = useRef({});
  const pending = useRef(null);
  const timer = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    if (!sketches.length) { setActiveId(null); return; }
    if (!sketches.some((s) => s.id === activeId)) setActiveId(sketches[0].id);
  }, [sketches, activeId]);
  useEffect(() => { if (activeId) onActive?.(activeId); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const job = pending.current;
    if (!job || saving.current) return;
    pending.current = null;
    saving.current = true;
    setSave({ state: 'saving', text: 'Saving...' });
    const q = getSupabase().from('job_sketches').update({ plan: job.plan }).eq('id', job.id);
    const seen = stamps.current[job.id];
    const { data, error } = await (seen ? q.eq('updated_at', seen) : q).select('updated_at');
    saving.current = false;
    if (error) {
      pending.current = pending.current || job;
      timer.current = setTimeout(flush, 15000); // try again by itself
      setSave({ state: 'error', text: `Not saved: ${error.message}` });
    } else if (!data || data.length === 0) {
      pending.current = null;
      setAside(job.id, { plan: job.plan, base: seen || null, at: new Date().toISOString() }); // keep the work so it can be downloaded
      setAsideCopy(true);
      setSave({ state: 'conflict', text: 'This sketch was changed on another device, so your last reading was not saved. Reload to see the latest.' });
    } else {
      stamps.current[job.id] = data[0].updated_at;
      cacheWrite(`sketch:${job.id}`, { id: job.id, plan: job.plan, updated_at: data[0].updated_at });
      if (!pending.current) clearBackup(job.id); // the server has everything; the device copy is no longer needed
      setSave({ state: 'saved', text: 'Saved' });
      syncAssets(job.plan);
    }
    if (pending.current) timer.current = setTimeout(flush, 300);
  }, [syncAssets]);

  const queueSave = useCallback((id, plan) => {
    pending.current = { id, plan };
    scheduleBackup(id, plan, stamps.current[id]); // a copy on this device until the server has it
    setSave({ state: 'dirty', text: 'Saving...' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  // leaving with changes still unsaved: warn, and try again the moment the connection comes back
  useEffect(() => {
    const warn = (e) => { if (pending.current || saving.current) { e.preventDefault(); e.returnValue = ''; } };
    const back = () => flush();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('online', back);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', back); };
  }, [flush]);

  function downloadAside() {
    const b = readAside(activeId);
    if (!b) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(b.plan)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `sketch-unsaved-${(b.at || '').slice(0, 10) || 'copy'}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const load = useCallback(async (id) => {
    setLoaded(null);
    setLoadErr('');
    let { data, error } = await getSupabase().from('job_sketches').select('id,name,plan,updated_at').eq('id', id).maybeSingle();
    let fromCopy = false;
    if (error && isNetworkError(error)) {
      // no signal: open the copy kept on this phone
      const c = await cacheRead(`sketch:${id}`);
      if (c) { data = c; error = null; fromCopy = true; }
    }
    if (error || !data) { setLoadErr(error?.message || 'Could not open this sketch.'); return; }
    if (!fromCopy) cacheWrite(`sketch:${id}`, { id: data.id, name: data.name, plan: data.plan, updated_at: data.updated_at });
    stamps.current[data.id] = data.updated_at;
    setSave({ state: 'idle', text: '' });
    let plan = normalizePlan(data.plan);
    const b = readBackup(data.id);
    const act = backupAction(b ? { ...b, plan: normalizePlan(b.plan) } : null, data.updated_at, plan);
    if (act === 'restore') { plan = normalizePlan(b.plan); setNotice('Unsaved changes from this device were restored and are being saved.'); }
    else if (act === 'aside') { setAside(data.id, b); setNotice(''); }
    else { if (b) clearBackup(data.id); setNotice(''); }
    setAsideCopy(!!readAside(data.id));
    if (Object.keys(jobStdRef.current || {}).length) plan = withJobStandards(plan, jobStdRef.current); // the job's standards win over the sketch's own
    else if (Object.keys(plan.standards || {}).length) saveJobStandards(plan.standards); // the first sketch to have any sets the job's
    setLoaded({ id: data.id, name: data.name, plan });
    if (fromCopy) setNotice('Opened the copy saved on this phone (no signal). Your changes are kept on this phone and saved when you have signal.');
    if (act === 'restore') queueSave(data.id, plan);
  }, [queueSave, saveJobStandards]);

  useEffect(() => {
    if (!activeId) { setLoaded(null); return; }
    Promise.resolve(flush()).then(() => load(activeId));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sketches.length) {
    return (
      <div className="card">
        <h2>Moisture</h2>
        <p className="hint">Moisture readings are logged on the floorplan, so build and save a sketch first.</p>
        <button type="button" className="primary" onClick={onOpenSketch}>Go to Sketch</button>
      </div>
    );
  }

  const noRooms = loaded && !loaded.plan.rooms.length;

  return (
    <div className="card sketch-card moist-card">
      <div className="row moist-head" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="sketch-picker" role="tablist" aria-label="Floorplans">
          {sketches.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === activeId} className={s.id === activeId ? 'on' : ''} onClick={() => setActiveId(s.id)}>{s.name}</button>
          ))}
        </div>
        <span className="sketch-head-right"><span className={`sketch-save ${save.state}`} aria-live="polite">{save.state === 'saved' || save.state === 'dirty' || save.state === 'saving' ? save.text : ''}</span>{isOffice && jobId && <button type="button" className="secondary small" onClick={() => setLinkOpen(true)}>Adjuster link</button>}<span ref={setHeadSlot} /></span>
      </div>

      {loadErr && <div className="msg err">{loadErr}</div>}
      {notice && <div className="msg" role="status">{notice}</div>}
      {asideCopy && <div className="msg err">Changes made on this device were not saved because the sketch was changed somewhere else. Your copy is kept here. <button type="button" className="secondary small" onClick={downloadAside}>Download my copy</button> <button type="button" className="secondary small" onClick={() => { clearAside(activeId); setAsideCopy(false); }}>Discard it</button></div>}
      {(save.state === 'error' || save.state === 'conflict') && (
        <div className="msg err">
          {save.text}{' '}
          {save.state === 'error' && <button type="button" className="secondary small" onClick={flush}>Retry</button>}
          {save.state === 'conflict' && <button type="button" className="secondary small" onClick={() => load(activeId)}>Reload</button>}
        </div>
      )}

      {!loaded && !loadErr && <p className="muted">Opening floorplan...</p>}
      {noRooms && (
        <div>
          <p className="hint">This sketch has no rooms yet. Draw the rooms on the Sketch tab, then come back to log moisture.</p>
          <button type="button" className="primary" onClick={onOpenSketch}>Go to Sketch</button>
        </div>
      )}
      {loaded && !noRooms && (
        <FloorCanvas
          key={loaded.id}
          variant="moisture"
          plan={loaded.plan}
          exportName={`${loaded.name} moisture`}
          headSlot={headSlot}
          staff={staff}
          staffList={staffList}
          onChange={(plan) => { queueSave(loaded.id, plan); saveJobStandards(plan.standards || {}); }}
          reportInfo={{ ...(jobInfo || {}), ...(biz || {}) }}
          photoCounts={roomPhotoCounts(photos, loaded.id)}
          onAddReadingPhoto={onAddPhoto ? (key) => onAddPhoto(loaded.id, { id: key }) : undefined}
          onViewReadingPhotos={onViewPhotos ? (key) => onViewPhotos(photos.filter((x) => !x.archived_at && x.sketch_id === loaded.id && x.room_key === key)) : undefined}
          command={command}
          onCommandDone={onCommandDone}
          equipGate={equipGate}
          onEquipBlocked={onEquipBlocked}
          assets={inv ? { list: inv.map((a) => ({ ...a, tag: assetTag(prefixRef.current, a.asset_no) })) } : null}
        />
      )}
      {linkOpen && <AdjusterLink jobId={jobId} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}
