'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import NotificationRow from '../../components/NotificationRow';

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
            <h3 style={{ margin: 0 }}>
              System Notifications {unreadCount > 0 ? `(${unreadCount} new)` : ''}
              <span
                className="info-tip"
                title="Automatic alerts — a contract signed, a work order accepted, and similar. For customer conversations, see Messages."
                aria-label="Automatic alerts — a contract signed, a work order accepted, and similar. For customer conversations, see Messages."
              >?</span>
            </h3>
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
          {visible.length === 0 && <div className="empty-state">{showDismissed ? 'No notifications yet.' : 'Nothing to show — try "Show dismissed" to see cleared notifications.'}</div>}
          {visible.map(n => (
            <NotificationRow key={n.id} notification={n} onMarkRead={markNotificationRead} onDismiss={dismissNotification} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
