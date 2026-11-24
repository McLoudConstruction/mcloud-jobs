'use client';

import { useState } from 'react';
import MapLink from '@/components/MapLink';
import { displayPhone, telHref } from '@/lib/phone';
import { quickActions } from '@/lib/quickActions';
import { CarIcon, StopwatchIcon, FinishFlagIcon, ChatBubbleIcon, ClockInIcon, ClockOutIcon } from '@/components/job/QuickIcons';
import './quickactions.css';

const ICONS = { otw: CarIcon, eta: CarIcon, start: StopwatchIcon, finish: FinishFlagIcon, finish_visit: FinishFlagIcon, chat: ChatBubbleIcon };
const GRID_ICONS = { clock_in: ClockInIcon, clock_out: ClockOutIcon }; // icons on the buttons below the row
const MAIN = ['otw', 'eta', 'start', 'finish', 'finish_visit', 'chat']; // the icon row; the rest are the buttons below it

// Full-screen list of big buttons for everything the tech can do on this job right now (like Drive Mode in McLoudJobs).
// Shows the customer, a tappable address (opens the maps app) and phone, then the actions for this kind of job and where the job is.
// `run(key)` does the action (it may throw; the message shows here). The screen closes after an action that moves to another screen.
export default function QuickActionScreen({ open, onClose, onExit, landing = false, job, customerName, visitStatus, canStart = true, clock, service, tabs, hasSketch, run, badges = {}, dayOne = false, restoration = false, canComplete = false }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!open) return null;

  const actions = quickActions({ service, visitStatus, jobStatus: job.status, clock, tabs, hasSketch, canStart, dayOne, restoration, canComplete });
  const main = actions.filter((a) => MAIN.includes(a.key));
  const rest = actions.filter((a) => !MAIN.includes(a.key));
  const groups = [['now', 'Next'], ['work', 'On the job'], ['job', 'Job']];
  const phone = job.customer?.phone;

  async function go(a) {
    setErr('');
    setBusy(a.key);
    try {
      await run(a.key);
      if (!(landing && ['otw', 'eta', 'start', 'finish', 'finish_visit', 'complete_job', 'dayone', 'clock_in', 'clock_out', 'photos', 'chat'].includes(a.key))) onClose(); // on the landing page these stay put (camera and chat open on top of it, the buttons update in place)
    } catch (e) {
      setErr(e?.message || 'That did not work. Try again.');
    }
    setBusy('');
  }

  return (
    <div className={`qa-screen${landing ? ' landing' : ''}`} role={landing ? 'main' : 'dialog'} aria-label="Quick actions">
      <div className="qa-head">
        <div className="qa-title">
          <div className="qa-job">Job #{job.job_number}</div>
          <div className="qa-customer">{customerName}</div>
        </div>
        <button type="button" className="qa-close" aria-label={landing ? 'Exit quick actions' : 'Close quick actions'} title={landing ? 'Exit quick actions' : undefined} onClick={onExit || onClose}>&times;</button>
      </div>
      <div className="qa-body">
        <div className="qa-site">
          <div className="qa-address"><MapLink address={job.address} /></div>
          {job.address?.gate_code && <div>Gate code: <strong>{job.address.gate_code}</strong></div>}
          {job.address?.warnings && <div>Pets: <strong>{job.address.warnings}</strong></div>}
          {job.address?.access_notes && <div className="muted">{job.address.access_notes}</div>}
          {phone && <a className="qa-call" href={telHref(phone)}>Call {displayPhone(phone)}</a>}
          {job.loss_summary && <div className="qa-loss">{job.loss_summary}</div>}
        </div>
        {err && <div className="msg err">{err}</div>}
        {main.length > 0 && (
          <div className="qa-row">
            {main.map((a) => {
              const Icon = ICONS[a.key];
              return (
                <button key={a.key} type="button" className={`qa-icon-btn${a.key === 'chat' ? '' : ' now'}`} disabled={!!busy} onClick={() => go(a)}>
                  <Icon />
                  <span>{busy === a.key ? 'Working...' : a.label}</span>
                  {badges[a.key] > 0 && <i className="qa-badge qa-badge-abs">{badges[a.key] > 99 ? '99+' : badges[a.key]}</i>}
                </button>
              );
            })}
          </div>
        )}
        {groups.map(([g, title]) => {
          const list = rest.filter((a) => a.group === g);
          if (!list.length) return null;
          return (
            <section key={g}>
              <h3 className="qa-group">{title}</h3>
              <div className="qa-grid">
                {list.map((a) => (
                  <button key={a.key} type="button" className={`qa-btn${g === 'now' ? ' now' : ''}`} disabled={!!busy} onClick={() => go(a)}>
                    <span className="qa-label">{GRID_ICONS[a.key] && (() => { const I = GRID_ICONS[a.key]; return <I width={30} height={30} />; })()}{busy === a.key ? 'Working...' : a.label}{badges[a.key] > 0 && <i className="qa-badge">{badges[a.key] > 99 ? '99+' : badges[a.key]}</i>}</span>
                    <span className="qa-hint">{a.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
