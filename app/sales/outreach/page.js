'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { VERTICAL_KEYS, verticalLabel } from '../../../lib/verticals';

const TABS = ['Today', 'Prospects', 'Sequences', 'Activity', 'Settings'];

const PROPERTY_COLS = 'id, property_name, property_type, property_city, property_state, contact_name, contact_email, contact_phone, prospect_stage, prospect_vertical, prospect_tier, prospect_source, last_contacted_at, next_action_at, next_action_note, do_not_contact';

const STATUS_LABELS = { active: 'Active', paused: 'Paused', replied: 'Replied', completed: 'Completed', unsubscribed: 'Unsubscribed', bounced: 'Bounced', stopped: 'Stopped' };
const STATUS_BADGE = { active: 'badge-active', replied: 'badge-approved', completed: 'badge-completed' };
const EVENT_LABELS = { sent: 'Sent', failed: 'Failed', skipped: 'Skipped', task_created: 'Task', opened: 'Opened', clicked: 'Clicked', replied: 'Replied', bounced: 'Bounced', unsubscribed: 'Unsubscribed', stopped: 'Stopped' };

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// PostgREST caps a single response at 1000 rows, so anything that can grow
// past that (properties, enrollments) is read page by page.
async function fetchAll(buildQuery) {
  const rows = [];
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await buildQuery().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return rows;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const EMPTY_STEP = { step_type: 'email', delay_days: 3, subject: '', body_text: '', task_note: '' };

// ─── Today ──────────────────────────────────────────────────────────────
function TodayTab({ properties, enrollments, settings, canToggle, onChanged, setError }) {
  const now = Date.now();
  const [toggling, setToggling] = useState(false);
  const due = properties
    .filter(p => p.next_action_at && new Date(p.next_action_at).getTime() <= now)
    .sort((a, b) => new Date(a.next_action_at) - new Date(b.next_action_at));

  const counts = enrollments.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const sentThisWeek = enrollments.filter(e => e.last_sent_at && new Date(e.last_sent_at).getTime() > weekAgo).length;

  async function setEnabled(value) {
    setError(''); setToggling(true);
    const { error } = await supabase.from('app_settings').update({ outreach_enabled: value }).eq('id', 1);
    setToggling(false);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  async function markDone(p) {
    setError('');
    const { error } = await supabase.from('properties').update({ next_action_at: null, next_action_note: null, last_contacted_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  async function snooze(p, days) {
    setError('');
    const when = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const { error } = await supabase.from('properties').update({ next_action_at: when }).eq('id', p.id);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  return (
    <>
      <div className="card" style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          Automatic outreach emails are <strong>{settings?.outreach_enabled ? 'ON' : 'OFF'}</strong>
          {settings?.outreach_enabled
            ? `. Up to ${settings.outreach_daily_limit ?? 20} a day, sent with the morning automations.`
            : '. No sequence emails will go out. Task reminders and replies still show up below.'}
        </div>
        {canToggle && (
          <button type="button" className={`btn btn-sm ${settings?.outreach_enabled ? 'btn-danger' : 'btn-primary'}`} disabled={toggling} onClick={() => setEnabled(!settings?.outreach_enabled)}>
            {settings?.outreach_enabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      <div className="card">
        <h3>Contact today</h3>
        {due.length === 0 && <div className="empty-state">Nothing due. Calls, visits and replies to follow up on will appear here.</div>}
        {due.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.property_name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{p.next_action_note || 'Follow up'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                {[p.contact_name, p.contact_phone, p.contact_email].filter(Boolean).join(' · ') || 'No contact on file'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => markDone(p)}>Done</button>
              <button type="button" className="btn btn-sm" onClick={() => snooze(p, 3)}>Snooze 3 days</button>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Sequence status</h3>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13 }}>
          <div><strong>{counts.active || 0}</strong> active</div>
          <div><strong>{sentThisWeek}</strong> emailed in the last 7 days</div>
          <div><strong>{counts.replied || 0}</strong> replied</div>
          <div><strong>{counts.completed || 0}</strong> finished</div>
          <div><strong>{(counts.unsubscribed || 0) + (counts.bounced || 0)}</strong> unsubscribed or bounced</div>
        </div>
      </div>
    </>
  );
}

// ─── Prospects ──────────────────────────────────────────────────────────
function ProspectsTab({ properties, enrollments, sequences, onChanged, setError }) {
  const [search, setSearch] = useState('');
  const [vertical, setVertical] = useState('');
  const [tier, setTier] = useState('');
  const [hasEmail, setHasEmail] = useState(false);
  const [notEnrolled, setNotEnrolled] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkVertical, setBulkVertical] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const enrolledIds = useMemo(() => new Set(enrollments.filter(e => ['active', 'paused'].includes(e.status)).map(e => e.property_id)), [enrollments]);
  const verticals = useMemo(() => [...new Set([...VERTICAL_KEYS, ...properties.map(p => p.prospect_vertical).filter(Boolean)])].sort(), [properties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter(p => {
      if (q && !`${p.property_name} ${p.property_city || ''} ${p.contact_name || ''} ${p.contact_email || ''}`.toLowerCase().includes(q)) return false;
      if (vertical === '__none' ? p.prospect_vertical : vertical && p.prospect_vertical !== vertical) return false;
      if (tier === '__none' ? p.prospect_tier : tier && p.prospect_tier !== tier) return false;
      if (hasEmail && !(p.contact_email || '').trim()) return false;
      if (notEnrolled && enrolledIds.has(p.id)) return false;
      return true;
    });
  }, [properties, search, vertical, tier, hasEmail, notEnrolled, enrolledIds]);

  const shown = filtered.slice(0, 300);
  const selectedIds = [...selected];

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function selectAllShown() {
    setSelected(prev => {
      const allSelected = shown.every(p => prev.has(p.id));
      const next = new Set(prev);
      shown.forEach(p => { if (allSelected) next.delete(p.id); else next.add(p.id); });
      return next;
    });
  }

  async function bulkUpdate(patch, doneMessage) {
    setError(''); setNotice(''); setBusy(true);
    try {
      for (const ids of chunk(selectedIds, 100)) {
        const { error } = await supabase.from('properties').update(patch).in('id', ids);
        if (error) throw new Error(error.message);
      }
      setNotice(doneMessage);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    if (!sequenceId) { setError('Choose a sequence first.'); return; }
    setError(''); setNotice(''); setBusy(true);
    try {
      const total = { enrolled: 0, skipped_no_email: 0, skipped_blocked: 0, skipped_duplicate: 0 };
      for (const ids of chunk(selectedIds, 100)) {
        const { data, error } = await supabase.rpc('outreach_enroll_properties', { p_sequence_id: sequenceId, p_property_ids: ids });
        if (error) throw new Error(error.message);
        const r = Array.isArray(data) ? data[0] : data;
        Object.keys(total).forEach(k => { total[k] += (r?.[k] || 0); });
      }
      setNotice(`Enrolled ${total.enrolled}. Skipped: ${total.skipped_no_email} with no email, ${total.skipped_blocked} unsubscribed/blocked, ${total.skipped_duplicate} already in this sequence.`);
      setSelected(new Set());
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" placeholder="Search name, city, contact…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: '1 1 220px', minWidth: 0 }} />
          <select value={vertical} onChange={e => setVertical(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All verticals</option>
            <option value="__none">No vertical set</option>
            {verticals.map(v => <option key={v} value={v}>{verticalLabel(v)}</option>)}
          </select>
          <select value={tier} onChange={e => setTier(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All tiers</option>
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
            <option value="C">Tier C</option>
            <option value="__none">No tier</option>
          </select>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={hasEmail} onChange={e => setHasEmail(e.target.checked)} style={{ width: 'auto' }} /> Has email</label>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={notEnrolled} onChange={e => setNotEnrolled(e.target.checked)} style={{ width: 'auto' }} /> Not in a sequence</label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
          {filtered.length} match{filtered.length === 1 ? '' : 'es'}{filtered.length > shown.length ? ` (showing the first ${shown.length}; narrow the filters to see the rest)` : ''}. New prospects come in through Properties → Import from Excel.
        </div>
      </div>

      {selected.size > 0 && (
        <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{selected.size} selected</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" placeholder="Vertical (e.g. church)" value={bulkVertical} onChange={e => setBulkVertical(e.target.value)} style={{ width: 170 }} list="outreach-verticals" />
            <datalist id="outreach-verticals">{verticals.map(v => <option key={v} value={v} />)}</datalist>
            <button type="button" className="btn btn-sm" disabled={busy || !bulkVertical.trim()} onClick={() => bulkUpdate({ prospect_vertical: bulkVertical.trim() }, `Vertical set on ${selected.size} properties.`)}>Set vertical</button>
            {['A', 'B', 'C'].map(t => (
              <button key={t} type="button" className="btn btn-sm" disabled={busy} onClick={() => bulkUpdate({ prospect_tier: t }, `Tier ${t} set on ${selected.size} properties.`)}>Tier {t}</button>
            ))}
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => bulkUpdate({ do_not_contact: true }, `${selected.size} properties marked do-not-contact.`)}>Do not contact</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <select value={sequenceId} onChange={e => setSequenceId(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>
              <option value="">Choose a sequence…</option>
              {sequences.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !sequenceId} onClick={enroll}>{busy ? 'Working…' : 'Enroll in sequence'}</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}
      {notice && <div className="card" style={{ fontSize: 13, color: '#3a6b45' }}>{notice}</div>}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={shown.length > 0 && shown.every(p => selected.has(p.id))} onChange={selectAllShown} style={{ width: 'auto' }} /></th>
              <th>Name</th><th>Vertical</th><th>Tier</th><th>City</th><th>Contact</th><th>Email</th><th>Stage</th><th>Last contacted</th><th>Sequence</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.id} onClick={() => toggle(p.id)}>
                <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} onClick={e => e.stopPropagation()} style={{ width: 'auto' }} /></td>
                <td>{p.property_name}{p.do_not_contact && <span className="badge badge-lost" style={{ marginLeft: 6 }}>DNC</span>}</td>
                <td>{verticalLabel(p.prospect_vertical)}</td>
                <td>{p.prospect_tier || ''}</td>
                <td>{p.property_city || ''}</td>
                <td>{p.contact_name || ''}</td>
                <td>{p.contact_email || ''}</td>
                <td>{p.prospect_stage}</td>
                <td>{fmtDate(p.last_contacted_at)}</td>
                <td>{enrolledIds.has(p.id) ? <span className="badge badge-active">Enrolled</span> : ''}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-soft)', cursor: 'default' }}>No properties match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Sequences ──────────────────────────────────────────────────────────
function SequencesTab({ sequences, steps, enrollments, onChanged, setError }) {
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  // Which step's test email is in flight / last result: { index, busy, ok, message }
  const [testState, setTestState] = useState(null);

  async function sendTest(index) {
    const step = editing.steps[index];
    setError('');
    if (!step.subject.trim() || !step.body_text.trim()) { setError('Add a subject and a message before sending a test.'); return; }
    setTestState({ index, busy: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/sales/outreach/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ subject: step.subject, body_text: step.body_text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The test email could not be sent.');
      setTestState({ index, ok: true, message: `Sent to ${body.sentTo}. Merge tags show sample values (Pastor Smith, First Baptist Church).` });
    } catch (err) {
      setTestState({ index, ok: false, message: err.message });
    }
  }

  function startNew() {
    setTestState(null);
    setEditing({ id: null, name: '', vertical: '', description: '', active: true, steps: [{ ...EMPTY_STEP, delay_days: 0 }] });
  }

  function startEdit(seq) {
    setTestState(null);
    const mine = steps.filter(s => s.sequence_id === seq.id).sort((a, b) => a.step_number - b.step_number);
    setEditing({
      id: seq.id, name: seq.name, vertical: seq.vertical || '', description: seq.description || '', active: seq.active,
      steps: mine.length ? mine.map(s => ({ step_type: s.step_type, delay_days: s.delay_days, subject: s.subject || '', body_text: s.body_text || '', task_note: s.task_note || '' })) : [{ ...EMPTY_STEP, delay_days: 0 }],
    });
  }

  function patchStep(i, patch) {
    setEditing(prev => ({ ...prev, steps: prev.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }
  function moveStep(i, dir) {
    setEditing(prev => {
      const next = [...prev.steps];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...prev, steps: next };
    });
  }

  async function save() {
    setError('');
    const e = editing;
    if (!e.name.trim()) { setError('Give the sequence a name.'); return; }
    if (e.steps.length === 0) { setError('Add at least one step.'); return; }
    for (const [i, s] of e.steps.entries()) {
      if (s.step_type === 'email' && (!s.subject.trim() || !s.body_text.trim())) { setError(`Step ${i + 1} needs a subject and a message.`); return; }
      if (s.step_type === 'task' && !s.task_note.trim()) { setError(`Step ${i + 1} needs a note describing the task.`); return; }
    }
    setSaving(true);
    try {
      let id = e.id;
      const base = { name: e.name.trim(), vertical: e.vertical.trim() || null, description: e.description.trim() || null, active: e.active };
      if (id) {
        const { error } = await supabase.from('outreach_sequences').update(base).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from('outreach_sequences').insert(base).select('id').single();
        if (error) throw new Error(error.message);
        id = data.id;
      }
      const rows = e.steps.map((s, i) => ({
        sequence_id: id,
        step_number: i + 1,
        step_type: s.step_type,
        delay_days: Math.max(0, parseInt(s.delay_days, 10) || 0),
        subject: s.step_type === 'email' ? s.subject.trim() : null,
        body_text: s.step_type === 'email' ? s.body_text : null,
        task_note: s.step_type === 'task' ? s.task_note.trim() : null,
      }));
      const { error: upErr } = await supabase.from('outreach_sequence_steps').upsert(rows, { onConflict: 'sequence_id,step_number' });
      if (upErr) throw new Error(upErr.message);
      const { error: delErr } = await supabase.from('outreach_sequence_steps').delete().eq('sequence_id', id).gt('step_number', rows.length);
      if (delErr) throw new Error(delErr.message);
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(seq) {
    const openCount = enrollments.filter(x => x.sequence_id === seq.id).length;
    if (!confirm(`Delete "${seq.name}"?${openCount ? ` This also deletes ${openCount} enrollment${openCount === 1 ? '' : 's'} and their history.` : ''}`)) return;
    setError('');
    const { error } = await supabase.from('outreach_sequences').delete().eq('id', seq.id);
    if (error) { setError(error.message); return; }
    if (editing?.id === seq.id) setEditing(null);
    onChanged();
  }

  async function toggleActive(seq) {
    setError('');
    const { error } = await supabase.from('outreach_sequences').update({ active: !seq.active }).eq('id', seq.id);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  if (editing) {
    const activeCount = editing.id ? enrollments.filter(x => x.sequence_id === editing.id && x.status === 'active').length : 0;
    return (
      <div className="card">
        <h3>{editing.id ? 'Edit sequence' : 'New sequence'}</h3>
        <div style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
          <input type="text" placeholder="Name (e.g. Churches roof and parking intro)" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          <input type="text" placeholder="Vertical (optional, e.g. church)" value={editing.vertical} onChange={e => setEditing({ ...editing, vertical: e.target.value })} />
          <input type="text" placeholder="Notes to yourself (optional)" value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} style={{ width: 'auto' }} /> Active (can be enrolled)</label>
        </div>
        {activeCount > 0 && (
          <div style={{ fontSize: 12.5, color: '#a17c3f', margin: '12px 0 0' }}>
            {activeCount} active enrollment{activeCount === 1 ? '' : 's'} follow this sequence. They continue from the step number they&apos;re on, so avoid reordering steps that have already gone out.
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '14px 0 6px' }}>
          Merge tags: <code>{'{{first_name}}'}</code> <code>{'{{property_name}}'}</code> <code>{'{{sender_name}}'}</code>. Your signature, mailing address and an unsubscribe link are added automatically.
        </div>
        {editing.steps.map((s, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, margin: '10px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Step {i + 1}</strong>
              <select value={s.step_type} onChange={e => patchStep(i, { step_type: e.target.value })} style={{ width: 'auto' }}>
                <option value="email">Send email</option>
                <option value="task">Task for me (call, visit…)</option>
              </select>
              <label style={{ fontSize: 12.5, display: 'flex', gap: 5, alignItems: 'center' }}>
                {i === 0 ? 'Wait' : 'Then wait'}
                <input type="number" min="0" value={s.delay_days} onChange={e => patchStep(i, { delay_days: e.target.value })} style={{ width: 64 }} />
                day(s){i === 0 ? ' after enrollment' : ''}
              </label>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                <button type="button" className="btn btn-sm" disabled={i === editing.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, idx) => idx !== i) })}>Remove</button>
              </span>
            </div>
            {s.step_type === 'email' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <input type="text" placeholder="Subject" value={s.subject} onChange={e => patchStep(i, { subject: e.target.value })} />
                <textarea rows={8} placeholder={'Hi {{first_name}},\n\n…'} value={s.body_text} onChange={e => patchStep(i, { body_text: e.target.value })} />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" disabled={testState?.busy} onClick={() => sendTest(i)}>
                    {testState?.busy && testState.index === i ? 'Sending…' : 'Send a test to me'}
                  </button>
                  {testState && testState.index === i && !testState.busy && (
                    <span style={{ fontSize: 12, color: testState.ok ? '#3a6b45' : '#a13f3f' }}>{testState.message}</span>
                  )}
                </div>
              </div>
            ) : (
              <input type="text" placeholder="What to do (e.g. Call the office about the roof walk-through)" value={s.task_note} onChange={e => patchStep(i, { task_note: e.target.value })} />
            )}
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setEditing({ ...editing, steps: [...editing.steps, { ...EMPTY_STEP }] })}>+ Add step</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save sequence'}</button>
          <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Sequences</h3>
        <button type="button" className="btn btn-sm btn-primary" onClick={startNew}>+ New sequence</button>
      </div>
      {sequences.length === 0 && <div className="empty-state">No sequences yet. A sequence is a series of emails and reminders spaced over days or weeks.</div>}
      {sequences.map(seq => {
        const stepCount = steps.filter(s => s.sequence_id === seq.id).length;
        const mine = enrollments.filter(x => x.sequence_id === seq.id);
        return (
          <div key={seq.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{seq.name} {!seq.active && <span className="badge">Inactive</span>}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                {stepCount} step{stepCount === 1 ? '' : 's'} · {mine.filter(x => x.status === 'active').length} active · {mine.filter(x => x.status === 'replied').length} replied · {mine.length} total{seq.vertical ? ` · ${seq.vertical}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => startEdit(seq)}>Edit</button>
              <button type="button" className="btn btn-sm" onClick={() => toggleActive(seq)}>{seq.active ? 'Deactivate' : 'Activate'}</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(seq)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────
function ActivityTab({ enrollments, sequences, steps, properties, events, onChanged, setError }) {
  const [statusFilter, setStatusFilter] = useState('active');
  const seqById = useMemo(() => Object.fromEntries(sequences.map(s => [s.id, s])), [sequences]);
  const propById = useMemo(() => Object.fromEntries(properties.map(p => [p.id, p])), [properties]);
  const enrById = useMemo(() => Object.fromEntries(enrollments.map(e => [e.id, e])), [enrollments]);
  const stepCounts = useMemo(() => steps.reduce((acc, s) => { acc[s.sequence_id] = (acc[s.sequence_id] || 0) + 1; return acc; }, {}), [steps]);

  const rows = enrollments.filter(e => !statusFilter || e.status === statusFilter);

  async function setStatus(e, status) {
    setError('');
    const patch = status === 'stopped' ? { status, stop_reason: 'manual', next_send_at: null } : { status };
    const { error } = await supabase.from('outreach_enrollments').update(patch).eq('id', e.id);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  async function markReplied(e) {
    setError('');
    const { error } = await supabase.rpc('stop_outreach', { p_email: e.to_email, p_reason: 'replied' });
    if (error) { setError(error.message); return; }
    onChanged();
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Enrollments</h3>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Contact</th><th>Property</th><th>Sequence</th><th>Progress</th><th>Status</th><th>Last sent</th><th>Next</th><th></th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map(e => (
                <tr key={e.id} style={{ cursor: 'default' }}>
                  <td>{e.to_name ? `${e.to_name} · ` : ''}{e.to_email}</td>
                  <td>{propById[e.property_id]?.property_name || ''}</td>
                  <td>{seqById[e.sequence_id]?.name || ''}</td>
                  <td>{e.steps_done} / {stepCounts[e.sequence_id] || '?'}</td>
                  <td><span className={`badge ${STATUS_BADGE[e.status] || ''}`}>{STATUS_LABELS[e.status] || e.status}</span></td>
                  <td>{fmtDate(e.last_sent_at)}</td>
                  <td>{e.status === 'active' ? fmtDate(e.next_send_at) : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {e.status === 'active' && <button type="button" className="btn btn-sm" onClick={() => setStatus(e, 'paused')}>Pause</button>}
                    {e.status === 'paused' && <button type="button" className="btn btn-sm" onClick={() => setStatus(e, 'active')}>Resume</button>}
                    {['active', 'paused'].includes(e.status) && (
                      <>
                        {' '}<button type="button" className="btn btn-sm" onClick={() => markReplied(e)}>Replied</button>
                        {' '}<button type="button" className="btn btn-sm btn-danger" onClick={() => setStatus(e, 'stopped')}>Stop</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-soft)', cursor: 'default' }}>Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Recent events</h3>
        {events.length === 0 && <div className="empty-state">No activity yet.</div>}
        {events.map(ev => (
          <div key={ev.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--ink-soft)', minWidth: 110 }}>{fmtDateTime(ev.created_at)}</span>
            <strong style={{ minWidth: 80 }}>{EVENT_LABELS[ev.event_type] || ev.event_type}</strong>
            <span>{enrById[ev.enrollment_id]?.to_email || ''}</span>
            <span style={{ color: 'var(--ink-soft)' }}>{ev.detail || ''}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Settings (owner) ───────────────────────────────────────────────────
function SettingsTab({ settings, onChanged, setError }) {
  const [form, setForm] = useState(null);
  const [google, setGoogle] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      outreach_enabled: !!settings.outreach_enabled,
      outreach_from_email: settings.outreach_from_email || '',
      outreach_from_name: settings.outreach_from_name || '',
      outreach_daily_limit: settings.outreach_daily_limit ?? 20,
      outreach_postal_address: settings.outreach_postal_address || '',
    });
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/integrations/status', { headers: { Authorization: `Bearer ${session?.access_token}` } });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setGoogle(body.google || { connected: false });
      } catch { /* the status line is a convenience; settings still save without it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!form) return null;

  const problems = [];
  if (!form.outreach_from_email.trim()) problems.push('Choose the Gmail account emails send from.');
  if (!form.outreach_postal_address.trim()) problems.push('Add your business mailing address (required in commercial email).');
  if (google && !google.connected) problems.push('Connect Google under Settings → Integrations.');
  else if (google?.connected && !google.canSend) problems.push('Reconnect Google under Settings → Integrations to grant permission to send mail.');
  else if (google?.connected && form.outreach_from_email.trim() && google.label && google.label.toLowerCase() !== form.outreach_from_email.trim().toLowerCase()) {
    problems.push(`The connected Google account is ${google.label}, which doesn't match the address above.`);
  }

  async function save() {
    setError(''); setSaved(false); setSaving(true);
    const limit = Math.min(100, Math.max(1, parseInt(form.outreach_daily_limit, 10) || 20));
    const { error } = await supabase.from('app_settings').update({
      outreach_enabled: form.outreach_enabled,
      outreach_from_email: form.outreach_from_email.trim() || null,
      outreach_from_name: form.outreach_from_name.trim() || null,
      outreach_daily_limit: limit,
      outreach_postal_address: form.outreach_postal_address.trim() || null,
    }).eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setSaved(true);
    onChanged();
  }

  return (
    <div className="card">
      <h3>Outreach settings</h3>
      <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={form.outreach_enabled} onChange={e => setForm({ ...form, outreach_enabled: e.target.checked })} style={{ width: 'auto' }} />
          Send sequence emails (runs once a day with the other automations)
        </label>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 3 }}>Send from (your connected Google account)</div>
          <input type="email" value={form.outreach_from_email} onChange={e => setForm({ ...form, outreach_from_email: e.target.value })} placeholder={google?.label || 'you@yourbusiness.com'} />
          {google?.connected && google.label && form.outreach_from_email.trim().toLowerCase() !== google.label.toLowerCase() && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setForm({ ...form, outreach_from_email: google.label })}>Use {google.label}</button>
          )}
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 3 }}>Name shown to recipients</div>
          <input type="text" value={form.outreach_from_name} onChange={e => setForm({ ...form, outreach_from_name: e.target.value })} placeholder="Stachys at McLoud Construction" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 3 }}>Emails per day (1 to 100). Start low and raise it as replies come in.</div>
          <input type="number" min="1" max="100" value={form.outreach_daily_limit} onChange={e => setForm({ ...form, outreach_daily_limit: e.target.value })} style={{ width: 100 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 3 }}>Business mailing address (shown in every email footer)</div>
          <textarea rows={3} value={form.outreach_postal_address} onChange={e => setForm({ ...form, outreach_postal_address: e.target.value })} placeholder={'McLoud Construction\n123 Main St, Kansas City, MO 64106'} />
        </div>
      </div>
      {problems.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#a17c3f', margin: '14px 0 0' }}>
          Before emails can send:
          {problems.map(p => <div key={p}>• {p}</div>)}
          {(google && (!google.connected || !google.canSend)) && <div style={{ marginTop: 4 }}><Link href="/settings?tab=Integrations">Open Integrations</Link></div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
        {saved && <span style={{ fontSize: 12.5, color: '#3a6b45' }}>Saved.</span>}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function OutreachPage() {
  const { session, loading, role } = useRequireAuth();
  const [tab, setTab] = useState('Today');
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [properties, enrollments, seqRes, stepRes, evRes, setRes] = await Promise.all([
        fetchAll(() => supabase.from('properties').select(PROPERTY_COLS).order('property_name')),
        fetchAll(() => supabase.from('outreach_enrollments').select('id, sequence_id, property_id, to_email, to_name, status, steps_done, next_send_at, last_sent_at, enrolled_at').order('enrolled_at', { ascending: false })),
        supabase.from('outreach_sequences').select('*').order('created_at', { ascending: false }),
        supabase.from('outreach_sequence_steps').select('*'),
        supabase.from('outreach_events').select('id, enrollment_id, event_type, detail, created_at').order('created_at', { ascending: false }).limit(60),
        supabase.from('app_settings').select('outreach_enabled, outreach_from_email, outreach_from_name, outreach_daily_limit, outreach_postal_address').eq('id', 1).maybeSingle(),
      ]);
      for (const r of [seqRes, stepRes, evRes, setRes]) if (r.error) throw new Error(r.error.message);
      setData({ properties, enrollments, sequences: seqRes.data || [], steps: stepRes.data || [], events: evRes.data || [], settings: setRes.data });
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { if (session) refresh(); }, [session, refresh]);

  if (loading || !session) return null;

  const visibleTabs = TABS.filter(t => t !== 'Settings' || role === 'owner');

  return (
    <AppShell>
      <div className="container">
        <div className="tab-sections" style={{ margin: '0 0 14px' }}>
          <div className="tab-sections-pills">
            {visibleTabs.map(t => (
              <button key={t} type="button" className={`tab-section-btn ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); setError(''); }}>{t}</button>
            ))}
          </div>
        </div>
        {error && <div className="card" style={{ color: '#a13f3f', fontSize: 13 }}>{error}</div>}
        {!data ? (
          <div className="card" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Loading…</div>
        ) : (
          <>
            {tab === 'Today' && <TodayTab properties={data.properties} enrollments={data.enrollments} settings={data.settings} canToggle={role === 'owner'} onChanged={refresh} setError={setError} />}
            {tab === 'Prospects' && <ProspectsTab properties={data.properties} enrollments={data.enrollments} sequences={data.sequences} onChanged={refresh} setError={setError} />}
            {tab === 'Sequences' && <SequencesTab sequences={data.sequences} steps={data.steps} enrollments={data.enrollments} onChanged={refresh} setError={setError} />}
            {tab === 'Activity' && <ActivityTab enrollments={data.enrollments} sequences={data.sequences} steps={data.steps} properties={data.properties} events={data.events} onChanged={refresh} setError={setError} />}
            {tab === 'Settings' && role === 'owner' && <SettingsTab settings={data.settings} onChanged={refresh} setError={setError} />}
          </>
        )}
      </div>
    </AppShell>
  );
}
