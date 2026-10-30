'use client';
import Link from 'next/link';
import PopupModal from './PopupModal';
import LeadMap from './LeadMap';
import OpportunityPhotosPanel from './OpportunityPhotosPanel';
import { formatPhone } from '../lib/constants';
import { verticalLabel } from '../lib/verticals';

const ACTIVE_STAGES = ['prospecting', 'contacted', 'site_request'];
const EDITABLE_STAGES = ['prospecting', 'contacted', 'site_request', 'lost'];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div className="lp-row">
      <div className="lp-label">{label}</div>
      <div className="lp-value">{children}</div>
    </div>
  );
}

// Popup for one lead on the Sales page: details, map, and every action.
export default function LeadPopup({
  lead, stageLabels, badgeClass, onClose, onStageChange,
  onConvert, onScheduleWalk, onEdit, onDelete,
}) {
  const o = lead;
  const address = o ? (o.address || o.site_address || '') : '';
  const active = o ? ACTIVE_STAGES.includes(o.stage) : false;
  const title = o ? (o.company || o.contact_name || 'Unnamed') : '';

  return (
    <PopupModal open={!!o} onClose={onClose} maxWidth={620} align="top">
      {o && (
        <div className="lp">
          <div className="lp-head">
            <div style={{ minWidth: 0 }}>
              <div className="lp-title">{title}</div>
              {o.project && <div className="lp-sub">{o.project}</div>}
            </div>
            {o.stage === 'converted' ? (
              <span className={`badge ${badgeClass}`} style={{ flexShrink: 0 }}>Converted</span>
            ) : (
              <select
                className={`badge stage-pill ${badgeClass}`}
                value={o.stage}
                aria-label="Stage"
                onChange={e => onStageChange(o.id, e.target.value)}
              >
                {EDITABLE_STAGES.map(st => <option key={st} value={st}>{stageLabels[st]}</option>)}
              </select>
            )}
          </div>

          <div className="lp-actions">
            {o.stage === 'converted' ? (
              o.job_id && <Link href={`/jobs/${o.job_id}`} className="btn btn-primary btn-sm">View Job →</Link>
            ) : (
              <>
                {active && <button className="btn btn-primary btn-sm" onClick={() => onConvert(o.id)}>Convert to Opportunity</button>}
                {active && !o.bid_walk_scheduled_at && <button className="btn btn-sm" onClick={() => onScheduleWalk(o.id)}>Schedule Bid Walk</button>}
              </>
            )}
            <button className="btn btn-sm" onClick={() => onEdit(o)}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={() => onDelete(o.id)}>Delete</button>
          </div>

          <h4 className="lp-h">Lead details</h4>
          <div className="lp-grid">
            <Row label="Contact">{o.contact_name}</Row>
            <Row label="Email">{o.contact_email && <a href={`mailto:${o.contact_email}`}>{o.contact_email}</a>}</Row>
            <Row label="Phone">{o.contact_phone && <a href={`tel:${o.contact_phone}`}>{formatPhone(o.contact_phone)}</a>}</Row>
            <Row label="Company">{o.company}</Row>
            <Row label="Type">{o.project_type && (o.project_type === 'commercial' ? 'Commercial' : 'Residential')}</Row>
            <Row label="Timeline">{o.anticipated_timeline}</Row>
            <Row label="Referred by">{o.referral_name}</Row>
            <Row label="Address">{address}</Row>
            <Row label="Date entered">{fmtDate(o.date_taken)}</Row>
            <Row label="Bid walk">{o.bid_walk_scheduled_at && new Date(o.bid_walk_scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Row>
            <Row label="Source">
              {(o.lead_vertical || o.source === 'website') && (
                <>
                  {o.source === 'website' ? 'Website' : o.source}
                  {o.lead_vertical ? ` · ${verticalLabel(o.lead_vertical)} page` : ''}
                  {o.utm_campaign ? ` · campaign ${o.utm_campaign}` : ''}
                  {o.referrer ? ` · from ${o.referrer}` : ''}
                </>
              )}
            </Row>
            {o.stage === 'lost' && <Row label="Loss reason">{o.loss_reason || 'Not recorded'}</Row>}
          </div>

          {o.notes && (
            <>
              <h4 className="lp-h">Notes</h4>
              <div className="lp-notes">{o.notes}</div>
            </>
          )}

          {address && (
            <>
              <h4 className="lp-h">Location</h4>
              <LeadMap address={address} />
            </>
          )}

          {o.stage === 'site_request' && (
            <>
              <h4 className="lp-h">Photos</h4>
              <OpportunityPhotosPanel opportunityId={o.id} />
            </>
          )}
        </div>
      )}

      <style jsx>{`
        .lp{ display: flex; flex-direction: column; }
        .lp-head{ display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-right: 28px; }
        .lp-title{ font-size: 18px; font-weight: 700; color: var(--heading); overflow-wrap: anywhere; }
        .lp-sub{ font-size: 13.5px; color: var(--ink-soft); margin-top: 2px; overflow-wrap: anywhere; }
        .lp-actions{ display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0 4px; }
        .lp-h{ margin: 18px 0 8px; font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; }
        .lp-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
        .lp-row{ min-width: 0; }
        .lp-label{ font-size: 11.5px; color: var(--ink-soft); }
        .lp-value{ font-size: 13.5px; color: var(--ink); overflow-wrap: anywhere; }
        .lp-value a{ color: inherit; text-decoration: underline; }
        .lp-notes{ font-size: 13.5px; white-space: pre-wrap; color: var(--ink); }
        @media (max-width: 560px){ .lp-grid{ grid-template-columns: 1fr; } }
      `}</style>
    </PopupModal>
  );
}
