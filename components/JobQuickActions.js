'use client';
import { useEffect, useRef, useState } from 'react';

// The job's "do something" menu. Everything you might want to START from a
// job - post an update, raise a change order, request a waiver - is here, so
// nobody has to remember which tab holds the button.
//
// Actions are grouped by project stage. The group for the stage the job is
// in comes first, then actions that apply at any stage, then the other stages
// (plans change mid-project, so nothing is hidden - only reordered).
//
// Each action either:
//   - creates: opens its tab with the "new" form already open (run: create(dest))
//   - goes:    just opens the tab/section                       (run: go(dest))
//   - custom:  runs a handler passed in (portal invite, RFP, estimate document)

const STAGE_GROUPS = ['Sell', 'Plan', 'Build', 'Closeout'];

export function buildQuickActions({ job, role, stageTab, afterOpportunity, inFieldPhase, isDone, inviting, go, create, push, onRfp, onInvite }) {
  const canRfp = role === 'owner' || role === 'estimator';

  const groups = {
    Sell: [
      { key: 'scope', label: 'Add or edit scope', run: () => go('scope') },
      { key: 'estimate-doc', label: 'Generate estimate document', run: () => push(`/jobs/${job.id}/proposal`) },
      { key: 'floorplan', label: 'Plans: build or upload', run: () => go('floorplan') },
      canRfp && { key: 'rfp', label: 'Send an RFP to subs', run: onRfp },
    ],
    Plan: [
      { key: 'work-order', label: 'New work order', run: () => create('workOrders') },
      { key: 'budget', label: 'Open the budget', run: () => go('budget') },
      afterOpportunity && { key: 'selections', label: 'Material selections', run: () => go('approvedMaterials') },
    ],
    Build: afterOpportunity ? [
      { key: 'update', label: 'Post a project update', run: () => create('updates') },
      { key: 'internal', label: 'Add an internal update', run: () => create('internalUpdates') },
      { key: 'change-order', label: 'New change order', run: () => create('changeOrders') },
      { key: 'job-cost', label: 'Add a job cost / receipt', run: () => create('jobCosts') },
      { key: 'draw', label: 'New progress invoice', run: () => create('draws') },
      { key: 'waiver', label: 'Request a lien waiver', run: () => create('waivers') },
      { key: 'pay-app', label: 'Pay application', run: () => go('payApps') },
    ] : [],
    Closeout: inFieldPhase ? [
      { key: 'punch', label: 'Add a punch item', run: () => create('punch') },
      { key: 'warranty', label: 'Warranty claims', run: () => go('warranty') },
      isDone && { key: 'final-invoice', label: 'Final invoice', run: () => go('finalInvoice') },
      isDone && { key: 'review', label: 'Request a review', run: () => go('reviews') },
    ] : [],
  };

  const anytime = [
    { key: 'message', label: 'Message the customer', run: () => go('messages') },
    { key: 'email', label: 'Email the customer', run: () => go('email') },
    { key: 'invite', label: inviting ? 'Sending invite…' : job.portal_invited_at ? 'Resend portal invite' : 'Invite to customer portal', run: onInvite, disabled: inviting },
  ];

  const clean = list => list.filter(Boolean);
  const current = STAGE_GROUPS.includes(stageTab) ? stageTab : null;
  const out = [];
  if (current && clean(groups[current]).length) {
    out.push({ key: current, label: `${current} - where this job is`, current: true, items: clean(groups[current]) });
  }
  out.push({ key: 'anytime', label: 'Any time', items: anytime });
  for (const g of STAGE_GROUPS) {
    if (g === current || !clean(groups[g]).length) continue;
    out.push({ key: g, label: g, items: clean(groups[g]) });
  }
  return out;
}

// Desktop dropdown. (On mobile the page renders the same groups inside its
// bottom sheet.)
export default function JobQuickActions({ groups }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrapRef} className="quick-actions">
      <button type="button" className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        Quick actions <span aria-hidden="true" style={{ marginLeft: 4, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div className="quick-actions-menu" role="menu">
          {groups.map(g => (
            <div key={g.key} className="quick-actions-group">
              <div className={`quick-actions-heading ${g.current ? 'is-current' : ''}`}>{g.label}</div>
              {g.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="quick-actions-item"
                  disabled={item.disabled}
                  onClick={() => { setOpen(false); item.run(); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
