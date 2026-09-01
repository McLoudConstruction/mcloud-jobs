'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function NotificationsPage() {
  const { session, loading } = useRequireAuth();
  const [notifications, setNotifications] = useState([]);
  const [showDismissed, setShowDismissed] = useState(false);

  const loadNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*, jobs(job_number, customer_name)')
      .order('created_at', { ascending: false });
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadNotifications();
    const channel = supabase
      .channel('notifications-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifications)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadNotifications]);

  async function markNotificationRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }

  async function markAllNotificationsRead() {
    const unreadIds = notifications.filter(n => !n.read && !n.dismissed).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
  }

  // Dismissing clears it from the list — always implies read, too, so it
  // can never sit there still counting toward the unread badge.
  async function dismissNotification(id) {
    await supabase.from('notifications').update({ dismissed: true, read: true }).eq('id', id);
  }

  async function dismissAllRead() {
    const readIds = notifications.filter(n => n.read && !n.dismissed).map(n => n.id);
    if (readIds.length === 0) return;
    await supabase.from('notifications').update({ dismissed: true }).in('id', readIds);
  }

  if (loading || !session) return null;

  const visible = notifications.filter(n => showDismissed || !n.dismissed);
  const unreadCount = notifications.filter(n => !n.read && !n.dismissed).length;
  const dismissedCount = notifications.filter(n => n.dismissed).length;
  const readCount = notifications.filter(n => n.read && !n.dismissed).length;

  return (
    <AppShell>
      <div className="container">
        <div className="card">
          <div className="top-actions" style={{ marginBottom: 0 }}>
            <h3 style={{ margin: 0 }}>System Notifications {unreadCount > 0 ? `(${unreadCount} new)` : ''}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {unreadCount > 0 && <button className="btn btn-sm" onClick={markAllNotificationsRead}>Mark all read</button>}
              {readCount > 0 && <button className="btn btn-sm" onClick={dismissAllRead}>Dismiss all read</button>}
              {dismissedCount > 0 && (
                <button className="btn btn-sm" onClick={() => setShowDismissed(v => !v)}>
                  {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
                </button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 4 }}>
            Automatic alerts — a contract signed, a work order accepted, and similar. For customer conversations, see Messages.
          </div>
          {visible.length === 0 && <div className="empty-state">{showDismissed ? 'No notifications yet.' : 'Nothing to show — try "Show dismissed" to see cleared notifications.'}</div>}
          {visible.map(n => (
            <div key={n.id} className="update-entry notification-row" style={{ opacity: n.read || n.dismissed ? 0.6 : 1 }}>
              <div className="notification-row-main">
                <div className="update-date">{fmtDate(n.created_at)}{n.dismissed ? ' — Dismissed' : ''}</div>
                <p>{n.message}</p>
                {(n.job_id || (!n.read && !n.dismissed)) && (
                  <div className="section-actions">
                    {n.job_id && <Link href={`/jobs/${n.job_id}`} className="btn btn-sm">View job</Link>}
                    {!n.read && !n.dismissed && <button className="btn btn-sm" onClick={() => markNotificationRead(n.id)}>Mark read</button>}
                  </div>
                )}
              </div>
              {!n.dismissed && <button className="btn btn-sm notification-dismiss" onClick={() => dismissNotification(n.id)}>Dismiss</button>}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
