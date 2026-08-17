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
  const [questions, setQuestions] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase
      .from('job_questions')
      .select('*, jobs(job_number, customer_name)')
      .order('created_at', { ascending: false });
    if (data) setQuestions(data);
  }, []);

  const loadNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*, jobs(job_number, customer_name)')
      .order('created_at', { ascending: false });
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadQuestions();
    loadNotifications();
    const channel = supabase
      .channel('notifications-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, loadQuestions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifications)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadQuestions, loadNotifications]);

  async function markNotificationRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }

  async function markAllNotificationsRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
  }

  if (loading || !session) return null;

  const unanswered = questions.filter(q => !q.response);
  const answered = questions.filter(q => q.response);

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Notifications</h2>

        <div className="card">
          <div className="top-actions" style={{ marginBottom: 0 }}>
            <h3 style={{ margin: 0 }}>Messages {unanswered.length > 0 ? `(${unanswered.length} unanswered)` : ''}</h3>
          </div>
          {questions.length === 0 && <div className="empty-state">No customer messages yet.</div>}
          {unanswered.map(q => (
            <Link key={q.id} href={`/jobs/${q.job_id}`} className="job-row">
              <div className="job-main">
                <span className="job-number">#{q.jobs?.job_number} — {q.jobs?.customer_name}</span>
                <span className="job-customer" style={{ fontSize: 13, fontWeight: 400 }}>{q.message}</span>
                <span className="job-address">{fmtDate(q.created_at)}</span>
              </div>
              <span className="badge badge-new">Unanswered</span>
            </Link>
          ))}
          {answered.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12.5, color: 'var(--ink-soft)', cursor: 'pointer' }}>{answered.length} answered message{answered.length === 1 ? '' : 's'}</summary>
              {answered.map(q => (
                <Link key={q.id} href={`/jobs/${q.job_id}`} className="job-row" style={{ marginTop: 10 }}>
                  <div className="job-main">
                    <span className="job-number">#{q.jobs?.job_number} — {q.jobs?.customer_name}</span>
                    <span className="job-customer" style={{ fontSize: 13, fontWeight: 400 }}>{q.message}</span>
                  </div>
                </Link>
              ))}
            </details>
          )}
        </div>

        <div className="card">
          <div className="top-actions" style={{ marginBottom: 0 }}>
            <h3 style={{ margin: 0 }}>Notifications {notifications.filter(n => !n.read).length > 0 ? `(${notifications.filter(n => !n.read).length} new)` : ''}</h3>
            {notifications.some(n => !n.read) && <button className="btn btn-sm" onClick={markAllNotificationsRead}>Mark all read</button>}
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
