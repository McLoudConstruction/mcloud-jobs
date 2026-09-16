'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A running log of the same `notifications` table the Inbox > System
// Notifications page reads — this is a compact live feed of it pinned to
// the dashboard, not a separate notification system. More triggers will
// start writing into this same table over time (the Completion category
// on internal updates is the first), and they'll all show up here
// automatically since this just reads the table.
export default function NotificationsCard() {
  const [notifications, setNotifications] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('dismissed', false)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('dashboard-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  async function markRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }

  async function dismiss(id) {
    await supabase.from('notifications').update({ dismissed: true, read: true }).eq('id', id);
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="card dash-notifications-card">
      <div className="dash-notifications-header">
        <h3 style={{ margin: 0 }}>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}</h3>
        <Link href="/notifications" className="btn btn-sm">View all</Link>
      </div>
      <div className="dash-notifications-scroll">
        {notifications.length === 0 && <div className="empty-state">Nothing yet.</div>}
        {notifications.map(n => (
          <div key={n.id} className="dash-notification-row" style={{ opacity: n.read ? 0.6 : 1 }}>
            <div className="dash-notification-date">{fmtDate(n.created_at)}</div>
            <p>{n.message}</p>
            <div className="dash-notification-actions">
              {n.job_id && <Link href={`/jobs/${n.job_id}`} className="btn btn-sm">View job</Link>}
              {!n.read && <button className="btn btn-sm" onClick={() => markRead(n.id)}>Mark read</button>}
              <button className="btn btn-sm" onClick={() => dismiss(n.id)}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
