'use client';
import { useState } from 'react';
import Link from 'next/link';
import { categorizeNotification } from '../lib/notificationCategory';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// One compact line — Type · Job # · Customer · date/time — with a chevron
// that expands in place to the full original message text and the
// read/dismiss/view-job actions. Used on both the Dashboard's notifications
// rail and the full Notifications page so the two read as the same design,
// not two different takes on the same data.
export default function NotificationRow({ notification: n, onMarkRead, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const category = categorizeNotification(n.message);
  const jobNumber = n.jobs?.job_number;
  const customerName = n.jobs?.customer_name;
  const isRead = n.read || n.dismissed;

  return (
    <div className={`notif-row ${isRead ? 'is-read' : ''}`}>
      <button type="button" className="notif-row-head" onClick={() => setExpanded(e => !e)}>
        <span className="notif-row-tag">{category}</span>
        <span className="notif-row-meta">
          {jobNumber && <span className="notif-row-job">#{jobNumber}</span>}
          {customerName && <span className="notif-row-customer">{customerName}</span>}
        </span>
        <span className="notif-row-date">{fmtDate(n.created_at)}</span>
        <span className={`notif-row-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">›</span>
      </button>
      {expanded && (
        <div className="notif-row-details">
          <p>{n.message}{n.dismissed ? ' — Dismissed' : ''}</p>
          <div className="notif-row-actions">
            {n.job_id && <Link href={`/jobs/${n.job_id}`} className="btn btn-sm">View job</Link>}
            {!n.read && !n.dismissed && onMarkRead && <button type="button" className="btn btn-sm" onClick={() => onMarkRead(n.id)}>Mark read</button>}
            {!n.dismissed && onDismiss && <button type="button" className="btn btn-sm" onClick={() => onDismiss(n.id)}>Dismiss</button>}
          </div>
        </div>
      )}

      <style jsx>{`
        .notif-row{ border-bottom: 1px solid var(--line); }
        .notif-row:last-child{ border-bottom: none; }
        .notif-row.is-read{ opacity: 0.6; }
        .notif-row-head{
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 2px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
        }
        .notif-row-tag{
          flex-shrink: 0; font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em;
          text-transform: uppercase; padding: 3px 7px; border-radius: 4px;
          background: var(--panel); color: var(--ink-soft); white-space: nowrap;
        }
        .notif-row-meta{ flex: 1; min-width: 0; display: flex; gap: 6px; align-items: baseline; overflow: hidden; }
        .notif-row-job{ flex-shrink: 0; font-size: 11.5px; color: var(--ink-soft); }
        .notif-row-customer{ font-size: 12.5px; font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .notif-row-date{ flex-shrink: 0; font-size: 10.5px; color: var(--ink-soft); }
        .notif-row-chevron{ flex-shrink: 0; font-size: 16px; color: var(--ink-soft); transition: transform 0.15s; }
        .notif-row-chevron.open{ transform: rotate(90deg); }
        .notif-row-details{ padding: 0 2px 12px; }
        .notif-row-details p{ font-size: 12.5px; margin: 0 0 8px; line-height: 1.45; color: var(--ink); }
        .notif-row-actions{ display: flex; gap: 6px; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
