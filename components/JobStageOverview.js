'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { STAGE_LABELS } from '../lib/constants';
import { PUNCH_OPEN_STATUSES } from '../lib/punch';
import { fmtMoney } from '../lib/format';

// The landing page for each project stage (Sell, Plan, Build, Closeout) on a
// job. It answers "where does this stage stand?" at a glance and links to every
// section of the stage, so the sidebar's stage names can be real links.
//
// Every tile names a destination from lib/links.js (JOB_DESTINATIONS), so a
// section that moves needs no change here. Tiles that need a number load it
// with one cheap count query each; a failed query just shows a dash.

const ORDER = ['Sell', 'Plan', 'Build', 'Closeout'];

const BLURB = {
  Sell: 'Win the work. Build the scope, price it, and get the estimate and contract out.',
  Plan: 'Get ready to build. Set the budget, settle material selections and issue work orders.',
  Build: 'Do the work. Keep the customer posted, track costs and change orders, and bill as you go.',
  Closeout: 'Finish up. Clear the punch list, send the final invoice, and ask for a review.',
};

// One line of "what usually comes next", shown on the stage the job is in.
const NEXT_STEP = {
  new: 'Inspect the site, then build the scope.',
  inspected: 'Finish the scope and pricing, then send the estimate.',
  proposal_delivered: 'Follow up with the customer. Advance to Approved once they accept.',
  approved: 'Build the budget, send selection sheets and issue work orders. Advance to Scheduled when dates are set.',
  scheduled: 'Confirm selections and work orders before the start date. Advance to Active when work begins.',
  active: 'Post updates, log costs and bill draws. Advance to Completed when the work is done.',
  completed: 'Clear the punch list and send the final invoice.',
  invoiced: 'Follow up on payment, then request a review.',
  paid: 'Request a review and keep an eye on the warranty period.',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const dash = n => (n === null || n === undefined);
const dateOnly = s => (s ? new Date(String(s).length === 10 ? `${s}T00:00:00` : s) : null);
const shortDate = s => { const d = dateOnly(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
const words = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export default function JobStageOverview({ stage, job, jobId, currentStageTab, updates, changeOrders, afterOpportunity, inFieldPhase, isDone, onGo, onCreate }) {
  const [n, setN] = useState({});

  // Counts for this stage's tiles only.
  useEffect(() => {
    let alive = true;
    async function head(table, mod) {
      let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('job_id', jobId);
      if (mod) q = mod(q);
      const { count, error } = await q;
      return error ? null : count;
    }
    async function load() {
      let out = {};
      if (stage === 'Sell') {
        const [costLines] = await Promise.all([head('job_scope_actions')]);
        out = { costLines };
      } else if (stage === 'Plan') {
        const [workOrders, sheets, sheetsSent, phases] = await Promise.all([
          head('work_orders'),
          head('material_selections'),
          head('material_selections', q => q.not('sent_at', 'is', null)),
          head('job_phases'),
        ]);
        out = { workOrders, sheets, sheetsSent, phases };
      } else if (stage === 'Build') {
        const [internal, receipts, draws, payApps, waivers] = await Promise.all([
          head('job_updates', q => q.eq('is_internal', true)),
          head('receipts'),
          head('invoices'),
          head('pay_applications'),
          head('lien_waivers'),
        ]);
        out = { internal, receipts, draws, payApps, waivers };
      } else if (stage === 'Closeout') {
        const [{ data: punch, error: punchErr }, { data: warranty }] = await Promise.all([
          supabase.from('punch_items').select('status').eq('job_id', jobId).eq('kind', 'punch'),
          supabase.from('warranties').select('end_date').eq('job_id', jobId).maybeSingle(),
        ]);
        out = {
          punchTotal: punchErr ? null : (punch || []).length,
          punchOpen: punchErr ? null : (punch || []).filter(p => PUNCH_OPEN_STATUSES.includes(p.status)).length,
          warrantyEnd: warranty?.end_date || null,
        };
      }
      if (alive) setN(out);
    }
    setN({});
    load();
    return () => { alive = false; };
  }, [stage, jobId]);

  const sellItems = (job.scope_items || []).length;
  const price = Number(job.contract_price || 0);
  const projected = Number(job.projected_cost || 0);

  // gate: the job must have reached a phase before the tile has anything in it.
  const GATES = {
    afterOpportunity: [afterOpportunity, 'Opens once approved'],
    inFieldPhase: [inFieldPhase, 'Opens once work is underway'],
    isDone: [isDone, 'Opens once completed'],
  };

  const TILES = {
    Sell: [
      { key: 'scope', label: 'Scope', dest: 'scope', stat: sellItems ? plural(sellItems, 'line') : 'Not started', sub: 'What the customer is buying' },
      { key: 'cost', label: 'Cost', dest: 'cost', stat: dash(n.costLines) ? '—' : plural(n.costLines, 'trade line'), sub: 'Quantities and costs by trade' },
      { key: 'pricing', label: 'Pricing', dest: 'pricing', stat: price ? fmtMoney(price) : 'Not priced', sub: 'Contract price' },
      { key: 'estimate', label: 'Estimate & contract', href: `/jobs/${jobId}/proposal`, stat: job.proposal_sent_at ? 'Sent' : 'Not sent', sub: job.proposal_sent_at ? shortDate(job.proposal_sent_at) : 'Generate and send the estimate' },
      { key: 'sketch', label: 'Sketch & plans', dest: 'sketch', sub: 'Draw the floorplan or upload plans' },
    ],
    Plan: [
      { key: 'budget', label: 'Budget', dest: 'budget', stat: projected ? fmtMoney(projected) : '—', sub: 'Estimated vs committed vs actual' },
      { key: 'approved', label: 'Approved Materials', dest: 'approvedMaterials', gate: 'afterOpportunity', sub: 'What the customer signed off on' },
      { key: 'sheets', label: 'Selection Sheets', dest: 'selections', gate: 'afterOpportunity', stat: dash(n.sheets) ? '—' : plural(n.sheets, 'sheet'), sub: dash(n.sheetsSent) ? '' : `${n.sheetsSent} sent to the customer` },
      { key: 'work_orders', label: 'Work Orders', dest: 'workOrders', create: 'workOrders', createLabel: 'New work order', stat: dash(n.workOrders) ? '—' : plural(n.workOrders, 'work order'), sub: 'Issued to subcontractors' },
      { key: 'schedule', label: 'Schedule', dest: 'schedule', stat: dash(n.phases) ? '—' : plural(n.phases, 'phase'), sub: 'Phases, calendar and sub requests' },
    ],
    Build: [
      { key: 'updates', label: 'Project Updates', dest: 'updates', create: 'updates', createLabel: 'Post update', gate: 'afterOpportunity', stat: plural((updates || []).length, 'update'), sub: 'Seen by the customer' },
      { key: 'internal', label: 'Internal Updates', dest: 'internalUpdates', create: 'internalUpdates', createLabel: 'Add update', gate: 'afterOpportunity', stat: dash(n.internal) ? '—' : plural(n.internal, 'update'), sub: 'Staff only' },
      { key: 'change_orders', label: 'Change Orders', dest: 'changeOrders', create: 'changeOrders', createLabel: 'New change order', gate: 'afterOpportunity', stat: plural((changeOrders || []).length, 'change order'), sub: 'Scope and price changes' },
      { key: 'job_costs', label: 'Job Costs', dest: 'jobCosts', create: 'jobCosts', createLabel: 'Log a cost', gate: 'afterOpportunity', stat: dash(n.receipts) ? '—' : plural(n.receipts, 'receipt'), sub: 'Receipts and costs to date' },
      { key: 'draws', label: 'Draws', dest: 'draws', create: 'draws', createLabel: 'New draw', gate: 'afterOpportunity', stat: dash(n.draws) ? '—' : plural(n.draws, 'invoice'), sub: 'Progress invoices' },
      { key: 'pay_apps', label: 'Pay Apps', dest: 'payApps', gate: 'afterOpportunity', stat: dash(n.payApps) ? '—' : plural(n.payApps, 'application'), sub: 'Schedule of values billing' },
      { key: 'waivers', label: 'Lien Waivers', dest: 'waivers', create: 'waivers', createLabel: 'Request waiver', gate: 'afterOpportunity', stat: dash(n.waivers) ? '—' : plural(n.waivers, 'waiver'), sub: 'From subs and to the customer' },
    ],
    Closeout: [
      { key: 'punch', label: 'Punch List', dest: 'punchList', create: 'punchList', createLabel: 'Add item', gate: 'inFieldPhase', stat: dash(n.punchOpen) ? '—' : `${n.punchOpen} open`, sub: dash(n.punchTotal) ? '' : `${n.punchTotal} in total` },
      { key: 'warranty', label: 'Warranty', dest: 'warranty', gate: 'inFieldPhase', stat: n.warrantyEnd ? `Through ${shortDate(n.warrantyEnd)}` : 'Not started', sub: 'Starts when the job is completed' },
      { key: 'invoice', label: 'Final Invoice', dest: 'finalInvoice', gate: 'isDone', stat: words(job.invoice_status) || 'Not sent', sub: job.invoice_amount ? fmtMoney(job.invoice_amount) : '' },
      { key: 'review', label: 'Review Request', dest: 'reviews', gate: 'isDone', sub: 'Ask the customer for a review' },
    ],
  };

  const idx = ORDER.indexOf(stage);
  const curIdx = ORDER.indexOf(currentStageTab);
  const isCurrent = idx === curIdx;
  const pill = isCurrent
    ? { cls: 'current', text: `This job is in ${STAGE_LABELS[job.stage]}` }
    : curIdx === -1 ? null
    : idx < curIdx ? { cls: '', text: 'Earlier stage' } : { cls: '', text: 'Not reached yet' };

  return (
    <>
      <div className="card stage-head">
        <h3>{stage}</h3>
        <p className="stage-blurb">{BLURB[stage]}</p>
        {pill && <span className={`stage-pill ${pill.cls}`}>{pill.text}</span>}
        {isCurrent && NEXT_STEP[job.stage] && <p className="stage-next"><b>Next:</b> {NEXT_STEP[job.stage]}</p>}
      </div>

      <div className="stage-grid">
        {TILES[stage].map(t => {
          const gate = t.gate ? GATES[t.gate] : null;
          const locked = gate && !gate[0];
          const body = (
            <>
              <span className="stage-tile-top">
                <span className="stage-tile-label">{t.label}</span>
                <span className="stage-tile-go" aria-hidden="true">›</span>
              </span>
              {locked
                ? <span className="stage-tile-sub">{gate[1]}</span>
                : (<>
                    {t.stat && <span className="stage-tile-stat">{t.stat}</span>}
                    {t.sub && <span className="stage-tile-sub">{t.sub}</span>}
                  </>)}
            </>
          );
          return (
            <div key={t.key} className={`stage-tile ${locked ? 'locked' : ''}`}>
              {t.href
                ? <Link href={t.href} className="stage-tile-main">{body}</Link>
                : <button type="button" className="stage-tile-main" onClick={() => onGo(t.dest)}>{body}</button>}
              {t.create && !locked && (
                <button type="button" className="stage-tile-add" onClick={() => onCreate(t.create)}>+ {t.createLabel}</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
