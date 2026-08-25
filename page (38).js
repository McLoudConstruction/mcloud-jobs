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
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
  }

  if (loading || !session) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <AppShell>
      <div className="container">
        <div className="card">
          <div className="top-actions" style={{ marginBottom: 0 }}>
            <h3 style={{ margin: 0 }}>System Notifications {unreadCount > 0 ? `(${unreadCount} new)` : ''}</h3>
            {unreadCount > 0 && <button className="btn btn-sm" onClick={markAllNotificationsRead}>Mark all read</button>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 4 }}>
            Automatic alerts — a contract signed, a work order accepted, and similar. For customer conversations, see Messages.
          </div>
          {notifications.length === 0 && <div className="empty-state">No notifications yet.</div>}
          {notifications.map(n => (
            <div key={n.id} className="update-entry" style={{ opacity: n.read ? 0.6 : 1 }}>
              <div className="update-date">{fmtDate(n.created_at)}</div>
              <p>{n.message}</p>
              <div className="section-actions">
                {n.job_id && <Link href={`/jobs/${n.job_id}`} className="btn btn-sm">View job</Link>}
                {!n.read && <button className="btn btn-sm" onClick={() => markNotificationRead(n.id)}>Mark read</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
