'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import SwipeableRow from '../../components/SwipeableRow';
import NotificationRow from '../../components/NotificationRow';
import InboxConversations from '../../components/InboxConversations';

// Collapsed feed rows show a relative time (Mail/Messages convention) rather
// than a full timestamp — the full one still appears once a row is open.
function fmtRelative(v) {
  if (!v) return '';
  const diffMs = Date.now() - new Date(v).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The overall (system-wide) Inbox. Two views:
//   • Conversations — every email, customer portal message and subcontractor
//     message the platform has sent or received, across all jobs, plus system
//     emails that don't belong to a job (sub applications, sign-in links, …).
//   • System — the notification feed.
export default function MessagesPage() {
  const { session, loading } = useRequireAuth();
  const [notifications, setNotifications] = useState([]);
  const [view, setView] = useState('conversations');
  const [expandedNotifId, setExpandedNotifId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const loadNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*, jobs(project_number, customer_name)')
      .order('created_at', { ascending: false });
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadNotifications();
    const channel = supabase.channel('messages-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifications)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadNotifications]);

  if (loading || !session) return null;

  async function markNotificationRead(id) {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) { alert('Failed to mark as read: ' + error.message); return; }
    await loadNotifications();
  }

  // Dismissing clears it from the feed — always implies read, too, so it
  // can never sit there still counting toward the unread badge.
  async function dismissNotification(id) {
    const { error } = await supabase.from('notifications').update({ dismissed: true, read: true }).eq('id', id);
    if (error) { alert('Failed to dismiss: ' + error.message); return; }
    await loadNotifications();
  }

  const visible = notifications.filter(n => !n.dismissed);

  return (
    <AppShell>
      <div className="container container-wide">
        {!isMobile && (
          <div className="top-actions">
            <h2 style={{ margin: 0, color: 'var(--heading)' }}>Inbox</h2>
          </div>
        )}

        <ScrollFadeRow trackClassName="stage-tabs">
          <button type="button" className={`stage-tab ${view === 'conversations' ? 'active' : ''}`} onClick={() => setView('conversations')}>Conversations</button>
          <button type="button" className={`stage-tab ${view === 'system' ? 'active' : ''}`} onClick={() => setView('system')}>System</button>
        </ScrollFadeRow>

        {view === 'conversations' ? (
          <InboxConversations session={session} />
        ) : isMobile ? (
          <>
            {visible.length === 0 && <div className="empty-state">Nothing here.</div>}
            <div className="entity-mobile-list">
              {visible.map(n => {
                const expanded = expandedNotifId === n.id;
                return (
                  <SwipeableRow
                    key={n.id}
                    onMarkRead={!n.read ? () => markNotificationRead(n.id) : null}
                    onDismiss={() => dismissNotification(n.id)}
                  >
                    <button className="entity-mobile-row inbox-row" onClick={() => setExpandedNotifId(id => (id === n.id ? null : n.id))}>
                      {!n.read && <span className="entity-mobile-row-dot warn" aria-hidden="true" />}
                      <span className="entity-mobile-row-text">
                        <span className="entity-mobile-row-title">System{n.jobs?.project_number ? ` · #${n.jobs.project_number}` : ''}</span>
                        <span className={`entity-mobile-row-sub ${expanded ? '' : 'inbox-row-clamp'}`}>{n.message}</span>
                        {expanded && (
                          <span className="inbox-row-expanded-actions" onClick={e => e.stopPropagation()}>
                            {n.job_id && <Link href={`/jobs/${n.job_id}`} className="btn btn-sm">View job</Link>}
                            {!n.read && <button type="button" className="btn btn-sm" onClick={() => markNotificationRead(n.id)}>Mark read</button>}
                          </span>
                        )}
                      </span>
                      <span className="inbox-row-time">{fmtRelative(n.created_at)}</span>
                    </button>
                  </SwipeableRow>
                );
              })}
            </div>
          </>
        ) : (
          // System notifications have no conversation to open, so this is the
          // full-width row list — same component as the Dashboard rail and the
          // Notifications page.
          <div className="card">
            {visible.length === 0 && <div className="empty-state">Nothing here.</div>}
            {visible.map(n => (
              <NotificationRow key={n.id} notification={n} onMarkRead={markNotificationRead} onDismiss={dismissNotification} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
