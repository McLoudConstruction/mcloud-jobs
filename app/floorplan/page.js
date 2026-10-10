'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

// Floorplan sketch + takeoff. The drawing tool lives in /public/floorplan/tool.html
// and talks to this page by postMessage (fp:ready / fp:load / fp:prefill / fp:changed).
// Open as /floorplan?job=<job id>.

export default function FloorplanPage() {
  const { session, loading } = useRequireAuth();
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const frameRef = useRef(null);
  const planRef = useRef(null);      // last plan loaded from / sent to the DB
  const latest = useRef(null);       // latest { plan, takeoff } from the tool
  const saveTimer = useRef(null);
  const loadedRow = useRef(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('job');
    setJobId(q || '');
  }, []);

  useEffect(() => {
    if (!session || jobId === null) return;
    if (!jobId) {
      supabase.from('jobs').select('id, estimate_number, customer_name, project_address').order('created_at', { ascending: false }).limit(200)
        .then(({ data }) => setJobs(data || []));
      return;
    }
    supabase.from('jobs').select('id, estimate_number, customer_name, project_address').eq('id', jobId).single().then(({ data }) => setJob(data));
    supabase.from('job_floorplans').select('plan').eq('job_id', jobId).maybeSingle().then(({ data }) => {
      planRef.current = data?.plan || null;
      loadedRow.current = true;
      sendLoad();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, jobId]);

  const post = useCallback((msg) => {
    const w = frameRef.current?.contentWindow;
    if (w) w.postMessage(msg, window.location.origin);
  }, []);

  const sendLoad = useCallback(async () => {
    if (!loadedRow.current || !frameRef.current?.dataset.ready) return;
    post({ type: 'fp:load', plan: planRef.current });
    const { data } = await supabase.from('material_prices').select('item_name, unit_price');
    const byName = {};
    (data || []).forEach(p => { byName[String(p.item_name).toLowerCase()] = p.unit_price; });
    post({ type: 'fp:prefill', byName });
  }, [post]);

  const save = useCallback(async () => {
    if (!latest.current || !jobId) return;
    setStatus('Saving…');
    const { error } = await supabase.from('job_floorplans').upsert({
      job_id: jobId, plan: latest.current.plan, takeoff: latest.current.takeoff, updated_at: new Date().toISOString(),
    });
    setStatus(error ? 'Save failed: ' + error.message : 'Saved');
  }, [jobId]);

  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data || {};
      if (m.type === 'fp:ready') { frameRef.current.dataset.ready = '1'; sendLoad(); }
      if (m.type === 'fp:changed') {
        latest.current = { plan: m.plan, takeoff: m.takeoff };
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(save, 1500);
        setStatus('Unsaved changes…');
      }
    }
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(saveTimer.current); };
  }, [save, sendLoad]);

  // Replace the previously sent floorplan lines on this job's estimate with the current takeoff.
  async function sendToEstimate() {
    const tk = latest.current?.takeoff;
    if (!tk) { setStatus('Nothing to send yet — change the plan first.'); return; }
    const lines = tk.lines.filter(l => l.orderQty > 0);
    if (!window.confirm(`Send ${lines.length} takeoff lines to this job's estimate? Lines previously sent from the floorplan will be replaced (anything else on the estimate is untouched).`)) return;
    setBusy(true);
    try {
      await save();
      const del = await supabase.from('job_estimate_items').delete().eq('job_id', jobId).like('buffer_note', 'Floorplan takeoff%');
      if (del.error) throw del.error;
      const rows = lines.map(l => ({
        job_id: jobId, description: l.name, quantity: l.orderQty, unit_label: l.orderUnit,
        unit_price: l.unitPrice || 0, source: 'suggested',
        buffer_note: `Floorplan takeoff: ${l.net} ${l.netUnit} net + ${l.wastePct}% waste${l.rooms?.length ? ' (' + l.rooms.map(r => r.name).join(', ') + ')' : ''}`,
      }));
      const ins = await supabase.from('job_estimate_items').insert(rows);
      if (ins.error) throw ins.error;
      // Remember prices you typed so they prefill next time (a suggestion only, never auto-applied).
      const priced = lines.filter(l => l.unitPrice > 0);
      if (priced.length) {
        const { data: ex } = await supabase.from('material_prices').select('id, item_name');
        const idByName = {}; (ex || []).forEach(p => { idByName[String(p.item_name).toLowerCase()] = p.id; });
        for (const l of priced) {
          const id = idByName[l.name.toLowerCase()];
          const row = { item_name: l.name, unit_label: l.orderUnit, unit_price: l.unitPrice, updated_at: new Date().toISOString() };
          if (id) await supabase.from('material_prices').update(row).eq('id', id);
          else await supabase.from('material_prices').insert(row);
        }
      }
      setStatus(`Sent ${rows.length} lines to the estimate.`);
    } catch (err) { setStatus('Send failed: ' + (err.message || err)); }
    setBusy(false);
  }

  // Append the generated scope sentences to the job's scope, skipping any already there.
  async function addScope() {
    const tk = latest.current?.takeoff;
    if (!tk) { setStatus('Nothing to add yet — change the plan first.'); return; }
    setBusy(true);
    try {
      const { data: j, error } = await supabase.from('jobs').select('scope_items').eq('id', jobId).single();
      if (error) throw error;
      const have = new Set((j.scope_items || []).map(s => (s.text || '').trim().toLowerCase()));
      const add = [...new Set(tk.lines.filter(l => l.scope && l.orderQty > 0).map(l => l.scope))].filter(t => !have.has(t.trim().toLowerCase()));
      if (!add.length) { setStatus('Scope already contains these items.'); setBusy(false); return; }
      const up = await supabase.from('jobs').update({ scope_items: [...(j.scope_items || []), ...add.map(text => ({ text }))] }).eq('id', jobId);
      if (up.error) throw up.error;
      setStatus(`Added ${add.length} scope items to the job.`);
    } catch (err) { setStatus('Failed: ' + (err.message || err)); }
    setBusy(false);
  }

  if (loading || !session || jobId === null) return null;

  if (!jobId) {
    const term = search.trim().toLowerCase();
    const list = jobs.filter(j => !term || [j.estimate_number, j.customer_name, j.project_address].some(v => (v || '').toLowerCase().includes(term)));
    return (
      <AppShell>
        <div className="container">
          <h2 style={{ color: 'var(--heading)' }}>Floorplan</h2>
          <p style={{ color: 'var(--muted, #666)' }}>Pick a job to sketch its floorplan and build a material takeoff.</p>
          <input className="input" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 420, marginBottom: 12 }} />
          {list.map(j => (
            <div key={j.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border, #ddd)' }}>
              <Link href={`/floorplan?job=${j.id}`}>{j.estimate_number || 'Job'} — {j.customer_name || ''}</Link>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{j.project_address}</div>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container" style={{ maxWidth: 1400 }}>
        <div className="top-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Floorplan{job ? ` — ${job.customer_name || job.estimate_number || ''}` : ''}</h2>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          <button className="btn btn-sm" disabled={busy} onClick={save}>Save</button>
          <button className="btn btn-sm" disabled={busy} onClick={addScope}>Add scope to job</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={sendToEstimate}>Send to estimate</button>
          <Link href="/floorplan" className="btn btn-sm">Change job</Link>
        </div>
        <iframe
          ref={frameRef}
          src="/floorplan/tool.html?embed=1"
          title="Floorplan sketch and takeoff"
          style={{ width: '100%', height: 'calc(100vh - 170px)', minHeight: 560, border: '1px solid var(--border, #ddd)', borderRadius: 8, marginTop: 12, background: '#fff' }}
          allow="clipboard-write"
        />
      </div>
    </AppShell>
  );
}
