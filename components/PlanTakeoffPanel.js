'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { aiFetch } from '../lib/aiFetch';
import { jobHref } from '../lib/links';
import { flagScheduleStale } from '../lib/scheduleStale';

// Upload Plans: intake questions, upload, free page triage, then AI analysis one
// chunk at a time. Everything is saved as it goes, so a run can be stopped,
// resumed after a refresh, or continued after raising the job's token cap.
//
// Results are written by the server into the existing Scope tables:
// customer sentences into Scope, quantities into the trade breakdown on Cost.
// Items the AI could not confirm are flagged "Needs verification".

const BUCKET = 'job-plans';
const MAX_FILE_MB = 50;

const BUILDING_TYPES = [
  'Church or place of worship', 'Retail or restaurant', 'Office', 'Medical or dental', 'School or childcare',
  'Warehouse or industrial', 'Multifamily', 'Single family home', 'Hotel or hospitality', 'Mixed use', 'Other',
];
const WORK_TYPES = [
  { key: 'new', label: 'New construction', hint: 'A new building or addition' },
  { key: 'renovation', label: 'Renovation or buildout', hint: 'Changing or adding spaces and finishes in an existing building' },
  { key: 'repair', label: 'Repair', hint: 'Fixing damaged or failing existing work' },
  { key: 'replacement', label: 'Replacement', hint: 'Replacing existing systems or finishes, such as a roof or flooring' },
];

const fmtK = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${Math.round((n || 0) / 1000)}k`);
const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

export default function PlanTakeoffPanel({ jobId, onBack, onDone }) {
  const [runs, setRuns] = useState([]);
  const [budget, setBudget] = useState({ cap: null, used: 0 });
  const [form, setForm] = useState({ building_type: '', building_use: '', work_type: '', notes: '' });
  const [files, setFiles] = useState([]);
  const [phase, setPhase] = useState('form'); // form | preparing | running
  const [statusLine, setStatusLine] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);   // the run on screen
  const [progress, setProgress] = useState(null);
  const [capInput, setCapInput] = useState('');
  const stopRef = useRef(false);

  const loadRuns = useCallback(async () => {
    const { data } = await supabase.from('job_plan_takeoffs').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(10);
    setRuns(data || []);
    return data || [];
  }, [jobId]);

  const loadBudget = useCallback(async () => {
    const [{ data: o }, { data: r }] = await Promise.all([
      supabase.from('job_plan_budget').select('token_cap').eq('job_id', jobId).maybeSingle(),
      supabase.from('job_plan_takeoffs').select('tokens_used').eq('job_id', jobId),
    ]);
    // Keep this default in step with DEFAULT_JOB_TOKEN_CAP in lib/planTakeoff.js.
    setBudget({ cap: o?.token_cap || 1000000, used: (r || []).reduce((n, x) => n + (x.tokens_used || 0), 0) });
  }, [jobId]);

  useEffect(() => { loadRuns(); loadBudget(); }, [loadRuns, loadBudget]);

  const remaining = budget.cap != null ? Math.max(0, budget.cap - budget.used) : null;
  const formOk = form.building_type && form.work_type && files.length > 0 && (form.building_type !== 'Other' || form.building_use.trim());

  function pickFiles(list) {
    const next = [];
    let problem = '';
    for (const f of Array.from(list || [])) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { problem = `${f.name} is not a PDF.`; continue; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { problem = `${f.name} is over ${MAX_FILE_MB} MB. Split it into smaller PDFs.`; continue; }
      next.push(f);
    }
    setError(problem);
    setFiles(prev => [...prev, ...next.filter(n => !prev.some(p => p.name === n.name && p.size === n.size))]);
  }

  // Create the run, upload the PDFs, then prepare each one (free, no AI).
  async function startAnalysis() {
    setError('');
    setPhase('preparing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: run, error: insErr } = await supabase.from('job_plan_takeoffs').insert({
        job_id: jobId, building_type: form.building_type, building_use: form.building_use.trim() || null,
        work_type: form.work_type, notes: form.notes.trim() || null, status: 'draft', created_by: session?.user?.id || null,
      }).select('*').single();
      if (insErr) throw new Error('Could not start the run: ' + insErr.message);

      const meta = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setStatusLine(`Uploading ${f.name} (${i + 1} of ${files.length})`);
        const path = `${jobId}/${run.id}/${i}-${safeName(f.name)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: 'application/pdf', upsert: true });
        if (upErr) throw new Error(`Upload failed for ${f.name}: ${upErr.message}`);
        meta.push({ name: f.name, path, size: f.size });
      }
      const { error: metaErr } = await supabase.from('job_plan_takeoffs').update({ files: meta }).eq('id', run.id);
      if (metaErr) throw new Error('Could not save the file list: ' + metaErr.message);

      for (let i = 0; i < meta.length; i++) {
        setStatusLine(`Reading ${meta[i].name} (${i + 1} of ${meta.length}). No AI is used in this step.`);
        await aiFetch('/api/plans/prepare', { takeoffId: run.id, fileIndex: i });
      }
      const { data: fresh } = await supabase.from('job_plan_takeoffs').select('*').eq('id', run.id).single();
      setActive(fresh);
      setFiles([]);
      setPhase('form');
      setStatusLine('');
      loadRuns();
    } catch (err) {
      setError(err.message || 'Something went wrong preparing the plans.');
      setPhase('form');
      setStatusLine('');
      loadRuns();
    }
  }

  // The browser drives the loop: each call does one chunk, so no request is long.
  async function runLoop(runId) {
    stopRef.current = false;
    setError('');
    setPhase('running');
    let retries = 0;
    let last = null;
    try {
      while (!stopRef.current) {
        let res;
        try {
          res = await aiFetch('/api/plans/process', { takeoffId: runId });
        } catch (err) {
          // Hourly limit or lost connection: stop cleanly. Progress is saved, so Continue picks up here.
          setError(err.message);
          break;
        }
        last = res;
        setProgress(res);
        if (res.note) setStatusLine(res.note);
        if (['done', 'stopped', 'failed', 'busy'].includes(res.state)) break;
        if (res.state === 'retry') {
          retries += 1;
          if (retries > 4) { setError(res.message || 'The AI is busy. Try Continue again in a minute.'); break; }
          setStatusLine(`${res.message || 'Waiting'} Retrying shortly.`);
          await sleep(retries * 5000);
        } else {
          retries = 0;
        }
      }
    } finally {
      setPhase('form');
      await Promise.all([loadRuns(), loadBudget()]);
      if (last && (last.state === 'done' || last.state === 'stopped') && last.itemsAdded > 0) {
        await flagScheduleStale(jobId);
        if (onDone) onDone();
      }
    }
  }

  async function beginRun(runId) {
    setActive(null);
    await runLoop(runId);
  }

  async function retryFailed(run) {
    const chunks = (run.chunks || []).map(c => c.status === 'failed' ? { ...c, status: 'pending', attempts: 0, error: null } : c);
    const { error: e } = await supabase.from('job_plan_takeoffs').update({ chunks, status: 'ready', finalized_at: null, message: null }).eq('id', run.id);
    if (e) { setError('Could not reset the failed sheets: ' + e.message); return; }
    await runLoop(run.id);
  }

  async function resume(run) {
    await supabase.from('job_plan_takeoffs').update({ finalized_at: null }).eq('id', run.id);
    await runLoop(run.id);
  }

  async function deleteRunItems(run) {
    if (!window.confirm('Delete the quantities this run added to the trade breakdown? Scope sentences it wrote stay in place so you can edit them. Anything you added by hand is untouched.')) return;
    const { error: e } = await supabase.from('job_scope_actions').delete().eq('plan_takeoff_id', run.id);
    if (e) { setError('Could not delete the items: ' + e.message); return; }
    await supabase.from('job_plan_takeoffs').update({ items_added: 0, items_flagged: 0 }).eq('id', run.id);
    await flagScheduleStale(jobId);
    await loadRuns();
  }

  async function discardRun(run) {
    if (!window.confirm('Discard this plan run and delete its uploaded PDFs?')) return;
    const paths = [...(run.files || []).map(f => f.path), ...(run.chunks || []).map(c => c.path)].filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error: e } = await supabase.from('job_plan_takeoffs').delete().eq('id', run.id);
    if (e) { setError('Could not discard the run: ' + e.message); return; }
    if (active?.id === run.id) { setActive(null); }
    await Promise.all([loadRuns(), loadBudget()]);
  }

  async function saveCap() {
    const n = Math.round(Number(String(capInput).replace(/,/g, '')));
    if (!Number.isFinite(n)) return;
    try {
      await aiFetch('/api/plans/cap', { jobId, tokenCap: n });
      setCapInput('');
      await loadBudget();
    } catch (err) { setError(err.message); }
  }

  const running = phase === 'running';
  const usedPct = budget.cap ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Upload plans</h3>
        <span style={{ flex: 1 }} />
        {onBack && <button className="btn btn-sm" onClick={onBack} disabled={running || phase === 'preparing'}>Back</button>}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '8px 0 14px' }}>
        The AI reads your plan sheets and fills in Scope with quantities. It never prices anything. Anything it cannot confirm is still added and marked Needs verification.
      </p>

      {/* Budget */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, flexWrap: 'wrap', gap: 6 }}>
          <span><b>AI budget for this job:</b> {budget.cap == null ? '...' : `${fmtK(budget.used)} of ${fmtK(budget.cap)} tokens used`}</span>
          <span style={{ color: 'var(--ink-soft)' }}>{remaining != null ? `${fmtK(remaining)} left` : ''}</span>
        </div>
        <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${usedPct}%`, height: '100%', background: usedPct > 85 ? '#a13f3f' : 'var(--gold)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ maxWidth: 160 }} inputMode="numeric" placeholder="New cap, e.g. 2000000" value={capInput} onChange={e => setCapInput(e.target.value)} />
          <button className="btn btn-sm" onClick={saveCap} disabled={!capInput.trim()}>Change cap</button>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Owners only. Analysis stops at the cap and keeps everything found so far.</span>
        </div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 12 }}>{error}</div>}

      {/* Intake + upload */}
      {phase === 'form' && !active && (
        <div>
          <div className="two-col">
            <div>
              <label>Building type</label>
              <select value={form.building_type} onChange={e => setForm({ ...form, building_type: e.target.value })}>
                <option value="">Choose one</option>
                {BUILDING_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label>Use of the building {form.building_type === 'Other' ? '' : <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(optional)</span>}</label>
              <input value={form.building_use} onChange={e => setForm({ ...form, building_use: e.target.value })} placeholder="e.g. Sanctuary and fellowship hall" />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Type of work</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 4 }}>
              {WORK_TYPES.map(w => (
                <button type="button" key={w.key} onClick={() => setForm({ ...form, work_type: w.key })}
                  style={{ textAlign: 'left', padding: 10, borderRadius: 6, cursor: 'pointer', background: form.work_type === w.key ? 'var(--panel)' : 'transparent', border: form.work_type === w.key ? '2px solid var(--gold)' : '1px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{w.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{w.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Anything to focus on or leave out <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(optional)</span></label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Roof and gutters only. Ignore the parking lot." />
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Plan PDFs</label>
            <input type="file" accept="application/pdf,.pdf" multiple onChange={e => { pickFiles(e.target.files); e.target.value = ''; }} />
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
              Up to {MAX_FILE_MB} MB per file. For a large set, upload several PDFs, such as one per discipline. Big sets are fine, they are read in small pieces.
            </div>
            {files.map((f, i) => (
              <div key={f.name + i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span>{f.name} <span style={{ color: 'var(--ink-soft)' }}>{fmtMB(f.size)}</span></span>
                <button className="row-remove" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}>x</button>
              </div>
            ))}
          </div>

          <div className="section-actions">
            <button className="btn btn-primary btn-sm" disabled={!formOk} onClick={startAnalysis}>Upload and prepare</button>
          </div>
        </div>
      )}

      {phase === 'preparing' && <div style={{ fontSize: 13 }}>{statusLine || 'Working...'}</div>}

      {/* Review before spending tokens */}
      {phase === 'form' && active && <ReviewStep run={active} remaining={remaining} onStart={() => beginRun(active.id)} onDiscard={() => discardRun(active)} />}

      {running && (
        <div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Analyzing sheets: {progress ? `${progress.doneChunks} of ${progress.totalChunks} sections done` : 'starting'}
            {progress?.itemsAdded != null && ` \u00b7 ${progress.itemsAdded} items found`}
          </div>
          <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${progress && progress.totalChunks ? Math.round((progress.doneChunks / progress.totalChunks) * 100) : 3}%`, height: '100%', background: 'var(--gold)', transition: 'width 0.4s' }} />
          </div>
          {statusLine && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>{statusLine}</div>}
          <div className="section-actions">
            <button className="btn btn-sm" onClick={() => { stopRef.current = true; setStatusLine('Stopping after this section. You can continue later.'); }}>Stop after this section</button>
          </div>
        </div>
      )}

      {/* History */}
      {runs.length > 0 && !running && phase !== 'preparing' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6 }}>Plan runs for this job</div>
          {runs.map(r => <RunRow key={r.id} run={r} jobId={jobId} onContinue={() => resume(r)} onRetry={() => retryFailed(r)} onReview={() => setActive(r)} onDeleteItems={() => deleteRunItems(r)} onDiscard={() => discardRun(r)} />)}
        </div>
      )}
    </div>
  );
}

function ReviewStep({ run, remaining, onStart, onDiscard }) {
  const files = run.files || [];
  const selected = (run.chunks || []).reduce((n, c) => n + c.pages.length, 0);
  const totalPages = files.reduce((n, f) => n + (f.pages || 0), 0);
  const skipped = run.skipped || [];
  const counts = {};
  skipped.forEach(s => { counts[s.reason] = (counts[s.reason] || 0) + 1; });
  const over = remaining != null && run.est_tokens > remaining;
  const bad = files.filter(f => f.error);
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Ready to analyze</div>
      <div style={{ fontSize: 13 }}>
        {selected} of {totalPages} sheets will be analyzed. Estimated use is up to {fmtK(run.est_tokens)} tokens{remaining != null ? `, and this job has ${fmtK(remaining)} left` : ''}.
      </div>
      {skipped.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
          Skipped {skipped.length} sheets that cannot help a takeoff: {Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}.
        </div>
      )}
      {over && (
        <div style={{ fontSize: 12.5, color: '#8a5a00', marginTop: 8 }}>
          This is more than the budget left. The most useful sheets (plans and schedules) are analyzed first and it stops at the cap. You can raise the cap and continue later.
        </div>
      )}
      {bad.map(f => <div key={f.name} style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 6 }}>{f.name}: {f.error}</div>)}
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={onStart} disabled={selected === 0}>Analyze plans</button>
        <button className="btn btn-sm" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

const STATUS_LABEL = { draft: 'Not prepared', ready: 'Ready', processing: 'In progress', done: 'Complete', stopped: 'Stopped', failed: 'Failed' };

function RunRow({ run, jobId, onContinue, onRetry, onReview, onDeleteItems, onDiscard }) {
  const chunks = run.chunks || [];
  const done = chunks.filter(c => c.status === 'done').length;
  const failed = chunks.filter(c => c.status === 'failed').length;
  const pending = chunks.length - done - failed;
  const when = new Date(run.created_at).toLocaleString();
  const canContinue = ['ready', 'processing', 'stopped'].includes(run.status) && pending > 0;
  const unstarted = run.status === 'draft' || (run.status === 'ready' && done === 0 && !(run.tokens_used > 0));
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <b>{run.building_type || 'Plans'}</b> \u00b7 {({ new: 'New construction', renovation: 'Renovation', repair: 'Repair', replacement: 'Replacement' })[run.work_type] || run.work_type}
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
            {when} \u00b7 {STATUS_LABEL[run.status] || run.status} \u00b7 {done} of {chunks.length} sections \u00b7 {run.items_added || 0} items{run.items_flagged ? ` (${run.items_flagged} to verify)` : ''} \u00b7 {fmtK(run.tokens_used)} tokens
          </div>
          {run.message && <div style={{ fontSize: 11.5, color: '#8a5a00', marginTop: 2 }}>{run.message}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {unstarted && <button className="btn btn-sm btn-primary" onClick={onReview}>Review</button>}
          {canContinue && !unstarted && <button className="btn btn-sm btn-primary" onClick={onContinue}>Continue</button>}
          {failed > 0 && <button className="btn btn-sm" onClick={onRetry}>Retry failed sheets</button>}
          {(run.items_added > 0) && <Link className="btn btn-sm" href={jobHref(jobId, 'cost')}>View quantities</Link>}
          {(run.items_added > 0) && <button className="btn btn-sm" onClick={onDeleteItems}>Delete its items</button>}
          <button className="btn btn-sm btn-danger" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
