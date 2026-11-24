'use client';

import { useEffect, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { SignOverlay } from '@/components/SignaturePad';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';
import {
  SAFETY_CHECKS, CATEGORIES, STEP_KINDS, STEP_LABELS, latestByKind, stepStatus, nextDayOneStep,
  missingSafety, missingWalkthrough, cleanSafety, cleanWalkthrough, categoryOf,
} from '@/lib/waterDayOne';

// The three Day 1 steps of a water loss, shown as a small card (Overview) and recorded in a dialog.
// Safety and walkthrough are tick-and-save; the work authorization is signed on the phone, or "customer not present".
// Nothing here blocks moving around the job: only placing equipment waits (see lib/waterDayOne.js gateFor).

const STATUS_TEXT = { done: 'Done', absent: 'Not signed, customer not present', todo: 'To do' };

export function DayOneCard({ rows, onOpen, canComplete = false, onComplete, completeBusy = false, completeMsg = '' }) {
  const st = stepStatus(rows);
  const l = latestByKind(rows);
  const next = nextDayOneStep(rows);
  const cat = categoryOf(rows);
  return (
    <div className="card day-one-card">
      <div className="card-head"><h2>Day 1 steps</h2>{cat && <span className="badge">{`Category ${cat}`}</span>}</div>
      <ul className="dayone-steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {STEP_KINDS.map((k) => (
          <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden="true" style={{ width: 22, textAlign: 'center' }}>{st[k] === 'done' ? '✓' : st[k] === 'absent' ? '!' : '○'}</span>
            <button type="button" className="link-btn" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={() => onOpen(k)}>
              <strong>{STEP_LABELS[k]}</strong>
              <div className="muted">{STATUS_TEXT[st[k]]}{l[k]?.done_at && st[k] !== 'todo' ? `, ${fmtDateTime(l[k].done_at)}` : ''}</div>
            </button>
          </li>
        ))}
      </ul>
      {next && <button type="button" className="primary big" style={{ width: '100%', marginTop: 12 }} onClick={() => onOpen(next.step)}>{next.label}<span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>{next.hint}</span></button>}
      {canComplete && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className={next ? 'secondary' : 'primary'} style={{ width: '100%' }} disabled={completeBusy} onClick={onComplete}>{completeBusy ? 'Working...' : 'Complete job'}</button>
          <p className="hint" style={{ margin: '6px 0 0' }}>Every visit is finished. Completing the job is what makes the invoice draft.</p>
          {completeMsg && <div className="msg err">{completeMsg}</div>}
        </div>
      )}
    </div>
  );
}

export default function WaterDayOne({ step, message = '', onClose, jobId, staff, customerName, rows, photoCount = 0, onReload }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState({ checks: {}, source_stopped: null, source_note: '', older_home: false });
  const [walk, setWalk] = useState({ category: 0, reason: '' });
  const [name, setName] = useState('');
  const [signing, setSigning] = useState(false);
  const latest = latestByKind(rows);

  useEffect(() => {
    setErr('');
    setSigning(false);
    if (step === 'safety') setSafety(latest.safety?.data ? { source_note: '', older_home: false, ...latest.safety.data } : { checks: {}, source_stopped: null, source_note: '', older_home: false });
    if (step === 'walkthrough') setWalk({ category: Number(latest.walkthrough?.data?.category) || 0, reason: latest.walkthrough?.data?.reason || '' });
    if (step === 'authorization') setName(customerName || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function record(kind, fields, event) {
    setBusy(true);
    setErr('');
    const sb = getSupabase();
    const { error } = await sb.from('job_water_steps').insert({ job_id: jobId, kind, created_by: staff.id, ...fields });
    if (error) {
      setBusy(false);
      setErr(error.message.includes('row-level') ? 'Not allowed. The job may be closed.' : /does not exist|schema cache/i.test(error.message) ? 'Run migration 051 in Supabase first.' : error.message);
      return false;
    }
    await sb.from('job_events').insert({ job_id: jobId, actor_id: staff.id, actor_email: staff.email, kind: event.kind, details: event.details || {} });
    setBusy(false);
    onReload();
    onClose();
    return true;
  }

  const saveSafety = () => {
    const miss = missingSafety(safety);
    if (miss.length) { setErr(miss[0]); return; }
    return record('safety', { data: cleanSafety(safety) }, { kind: 'water_safety_done', details: { source_stopped: safety.source_stopped === true } });
  };

  const saveWalk = () => {
    const miss = missingWalkthrough(walk);
    if (miss.length) { setErr(miss[0]); return; }
    if (photoCount < 1) { setErr('Take the initial photos first: an overview and the damage in each affected room. They are the before record.'); return; }
    const prev = categoryOf(rows);
    return record('walkthrough', { data: cleanWalkthrough({ ...walk, photos_taken: true }) }, { kind: 'water_category_set', details: { category: Number(walk.category), ...(prev && prev !== Number(walk.category) ? { from: prev } : {}) } });
  };

  const markAbsent = () => {
    if (!window.confirm('Customer not present? The authorization stays unsigned and the office gets a task to send an e-sign link.')) return;
    return record('authorization', { customer_absent: true, data: {} }, { kind: 'water_authorization_absent' });
  };

  const sign = (url) => {
    if (name.trim().length < 2) { setErr('Type the customer’s full name.'); setSigning(false); return; }
    return record('authorization', { signer_name: name.trim(), signature_png: url, data: {} }, { kind: 'water_authorization_signed', details: { signer_name: name.trim() } });
  };

  if (!step) return null;

  if (step === 'authorization' && signing) {
    return <SignOverlay title={`${name.trim()}, sign below`} doneLabel="Sign" error={err} onCancel={() => setSigning(false)} onDone={sign} />;
  }

  const title = STEP_LABELS[step];
  return (
    <PopupModal open onClose={onClose} title={title} closeOnOverlay={false}>
      {message && <div className="msg err">{message}</div>}
      {err && <div className="msg err">{err}</div>}

      {step === 'safety' && (
        <div>
          <p className="hint">Before any work starts. It takes about a minute.</p>
          {SAFETY_CHECKS.map(([k, label]) => (
            <label key={k} className="check-row" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', fontSize: 16 }}>
              <input type="checkbox" style={{ width: 24, height: 24 }} checked={safety.checks?.[k] === true} onChange={(e) => setSafety((s) => ({ ...s, checks: { ...s.checks, [k]: e.target.checked } }))} />
              <span>{label}</span>
            </label>
          ))}
          <div className="field">
            <label>Is the source of the water stopped?</label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className={safety.source_stopped === true ? 'primary big' : 'secondary big'} style={{ flex: 1 }} onClick={() => setSafety((s) => ({ ...s, source_stopped: true }))}>Yes</button>
              <button type="button" className={safety.source_stopped === false ? 'primary big' : 'secondary big'} style={{ flex: 1 }} onClick={() => setSafety((s) => ({ ...s, source_stopped: false }))}>No</button>
            </div>
          </div>
          {safety.source_stopped === false && (
            <div className="field"><label htmlFor="src-note">What is being done about it?</label><input id="src-note" value={safety.source_note} onChange={(e) => setSafety((s) => ({ ...s, source_note: e.target.value }))} maxLength={300} /></div>
          )}
          <label className="check-row" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0' }}>
            <input type="checkbox" style={{ width: 24, height: 24 }} checked={safety.older_home === true} onChange={(e) => setSafety((s) => ({ ...s, older_home: e.target.checked }))} />
            <span>Built before 1978, or suspect asbestos: lead and asbestos checks before demo</span>
          </label>
          <p className="hint">A photo of the source helps the carrier. Use the camera button on the job.</p>
          <button type="button" className="primary big" style={{ width: '100%' }} disabled={busy} onClick={saveSafety}>{busy ? 'Saving...' : 'Record safety check'}</button>
        </div>
      )}

      {step === 'walkthrough' && (
        <div>
          <p className="hint">Take initial photos first: an overview, the damage and any standing water in each affected room, and the meter on the wet edges. They are the before record. {photoCount} photo{photoCount === 1 ? '' : 's'} on this job so far.</p>
          <div className="field">
            <label>Category of the water</label>
            {CATEGORIES.map(([n, label, hint]) => (
              <button key={n} type="button" className={Number(walk.category) === n ? 'primary' : 'secondary'} style={{ display: 'block', width: '100%', textAlign: 'left', margin: '6px 0', padding: '12px 14px' }} onClick={() => setWalk((w) => ({ ...w, category: n }))}>
                <strong>{label}</strong><span className="muted" style={{ display: 'block', fontWeight: 400 }}>{hint}</span>
              </button>
            ))}
          </div>
          <div className="field"><label htmlFor="cat-reason">Why this category?</label><input id="cat-reason" value={walk.reason} onChange={(e) => setWalk((w) => ({ ...w, reason: e.target.value }))} maxLength={300} placeholder="Supply line burst under the kitchen sink" /></div>
          {latest.walkthrough && <p className="hint">Category can be raised later if it gets worse. Each change is logged.</p>}
          <button type="button" className="primary big" style={{ width: '100%' }} disabled={busy} onClick={saveWalk}>{busy ? 'Saving...' : latest.walkthrough ? 'Update category' : 'Record walkthrough'}</button>
        </div>
      )}

      {step === 'authorization' && (
        <div>
          {latest.authorization && !latest.authorization.customer_absent && <p className="hint">Signed by {latest.authorization.signer_name} on {fmtDateTime(latest.authorization.done_at)}. A new signature replaces it in the packet; the old one stays in the history.</p>}
          {latest.authorization?.customer_absent && <p className="hint">Customer was not present. Sign now if they are here, or the office sends an e-sign link.</p>}
          <p className="hint">Hand the phone to the customer. The work authorization covers the drying work and the prices on the estimate.</p>
          <div className="field">
            <label htmlFor="auth-signer">Who is signing?</label>
            <input id="auth-signer" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="Full name" />
            <p className="hint" style={{ margin: '6px 0 0' }}>The name on the job. Change it if someone else is signing, like a spouse who is home.</p>
          </div>
          <button type="button" className="primary big" style={{ width: '100%' }} disabled={busy || name.trim().length < 2} onClick={() => { setErr(''); setSigning(true); }}>Continue to signature</button>
          <button type="button" className="secondary big" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={markAbsent}>Customer not present</button>
        </div>
      )}
    </PopupModal>
  );
}
