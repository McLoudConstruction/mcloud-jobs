'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import NotificationRow from '../NotificationRow';

// A running log of the same `notifications` table the Inbox > System
// Notifications page reads — this is a compact live feed of it pinned to
// the dashboard, not a separate notification system. More triggers will
// start writing into this same table over time (the Completion category
// on internal updates is the first), and they'll all show up here
// automatically since this just reads the table. Rows render with
// NotificationRow — the same compact Type/Job/Customer/date + expander
// design as the full Notifications page, so this rail reads as a preview
// of that page rather than a different UI for the same data.
export default function NotificationsCard() {
  const [notifications, setNotifications] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*, jobs(job_number, customer_name)')
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
          <NotificationRow key={n.id} notification={n} onMarkRead={markRead} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}
