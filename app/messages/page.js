'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import SwipeableRow from '../../components/SwipeableRow';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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

export default function MessagesPage() {
  const { session, loading } = useRequireAuth();
  const [questions, setQuestions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile-only feed state: which chip filter is active, which system
  // notification is expanded in place, and which message thread (if any)
  // the feed has drilled into — the merged Inbox doc entry asks for a list →
  // detail pattern for messages (they're full conversations, not one-liners)
  // and inline expand-on-tap for system notifications (they're not).
  const [inboxFilter, setInboxFilter] = useState('all');
  const [expandedNotifId, setExpandedNotifId] = useState(null);
  const [mobileThreadId, setMobileThreadId] = useState(null);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase.from('job_questions').select('*, jobs(job_number, customer_name)').order('created_at', { ascending: true });
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
    const channel = supabase.channel('messages-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, loadQuestions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifications)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadQuestions, loadNotifications]);

  if (loading || !session) return null;

  // Group into one thread per job.
  const threadsByJob = {};
  for (const q of questions) {
    if (!threadsByJob[q.job_id]) threadsByJob[q.job_id] = [];
    threadsByJob[q.job_id].push(q);
  }
  const threads = Object.entries(threadsByJob).map(([jobId, msgs]) => {
    const last = msgs[msgs.length - 1];
    const unreadCount = msgs.filter(m => m.sender === 'customer' && !m.read_at).length;
    return { jobId, msgs, last, unreadCount, jobInfo: last.jobs };
  }).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

  const selectedThread = threads.find(t => t.jobId === selectedJobId) || threads[0];
  const activeJobId = selectedThread?.jobId;

  const mobileThread = threads.find(t => t.jobId === mobileThreadId);

  async function sendReply(e, jobIdOverride) {
    e.preventDefault();
    const jobId = jobIdOverride || activeJobId;
    if (!reply.trim() || !jobId) return;
    setSending(true);
    const thread = threadsByJob[jobId];
    const customerEmail = thread[0]?.customer_email;

    await supabase.from('job_questions').insert({
      job_id: jobId,
      customer_email: customerEmail,
      sender: 'admin',
      message: reply.trim(),
    });

    const unanswered = thread.filter(m => m.sender === 'customer' && !m.responded_at);
    if (unanswered.length > 0) {
      const now = new Date().toISOString();
      await supabase.from('job_questions').update({ responded_at: now, read_at: now }).in('id', unanswered.map(m => m.id));
    }

    setReply('');
    setSending(false);
  }

  async function markThreadReadFor(jobId) {
    const thread = threadsByJob[jobId];
    if (!thread) return;
    const unread = thread.filter(m => m.sender === 'customer' && !m.read_at);
    if (unread.length === 0) return;
    await supabase.from('job_questions').update({ read_at: new Date().toISOString() }).in('id', unread.map(m => m.id));
  }

  // Not every customer message needs a reply — this clears the unread
  // badge for the thread without sending anything back.
  async function markThreadRead() {
    if (!activeJobId) return;
    setMarkingRead(true);
    await markThreadReadFor(activeJobId);
    setMarkingRead(false);
  }

  async function markNotificationRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }

  // Dismissing clears it from the feed — always implies read, too, so it
  // can never sit there still counting toward the unread badge.
  async function dismissNotification(id) {
    await supabase.from('notifications').update({ dismissed: true, read: true }).eq('id', id);
  }

  // --- Merged Inbox feed (mobile only) ---
  const messageItems = threads.map(t => ({
    id: `msg-${t.jobId}`,
    kind: 'message',
    jobId: t.jobId,
    title: t.jobInfo?.customer_name || 'Unnamed',
    jobNumber: t.jobInfo?.job_number,
    preview: t.last.message,
    timestamp: t.last.created_at,
    unread: t.unreadCount > 0,
  }));
  const systemItems = notifications.filter(n => !n.dismissed).map(n => ({
    id: `sys-${n.id}`,
    kind: 'system',
    notifId: n.id,
    jobId: n.job_id,
    jobNumber: n.jobs?.job_number,
    preview: n.message,
    timestamp: n.created_at,
    unread: !n.read,
  }));
  const feed = [...messageItems, ...systemItems].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const filteredFeed = inboxFilter === 'all' ? feed : feed.filter(i => i.kind === (inboxFilter === 'messages' ? 'message' : 'system'));

  function handleRowTap(item) {
    if (item.kind === 'message') {
      setMobileThreadId(item.jobId);
      markThreadReadFor(item.jobId);
    } else {
      setExpandedNotifId(id => (id === item.id ? null : item.id));
    }
  }

  return (
    <AppShell>
      <div className="container container-wide">
        {!isMobile && (
          <div className="top-actions">
            <h2 style={{ margin: 0, color: 'var(--heading)' }}>Messages</h2>
          </div>
        )}

        {isMobile ? (
          mobileThread ? (
            <div className="mobile-inbox-detail">
              <button className="mobile-inbox-back" onClick={() => setMobileThreadId(null)}>‹ Inbox</button>
              <div className="messages-chat-header" style={{ padding: '10px 2px' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{mobileThread.jobInfo?.customer_name || 'Unnamed'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Job #{mobileThread.jobInfo?.job_number}</div>
                </div>
                <Link href={`/jobs/${mobileThreadId}`} className="btn btn-sm">View Job →</Link>
              </div>
              <div className="messages-thread-scroll">
                {mobileThread.msgs.map(m => (
                  <div key={m.id}>
                    <div className={`messages-bubble ${m.sender === 'admin' ? 'from-admin' : 'from-customer'}`}>
                      <div className="messages-bubble-text">{m.message}</div>
                      <div className="messages-bubble-time">{fmtDate(m.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={e => sendReply(e, mobileThreadId)} className="messages-compose">
                <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply…" rows={2} />
                <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
              </form>
            </div>
          ) : (
            <>
              <ScrollFadeRow trackClassName="stage-tabs">
                <button type="button" className={`stage-tab ${inboxFilter === 'all' ? 'active' : ''}`} onClick={() => setInboxFilter('all')}>All</button>
                <button type="button" className={`stage-tab ${inboxFilter === 'messages' ? 'active' : ''}`} onClick={() => setInboxFilter('messages')}>Messages</button>
                <button type="button" className={`stage-tab ${inboxFilter === 'system' ? 'active' : ''}`} onClick={() => setInboxFilter('system')}>System</button>
              </ScrollFadeRow>

              {filteredFeed.length === 0 && <div className="empty-state">Nothing here.</div>}

              <div className="entity-mobile-list">
                {filteredFeed.map(item => {
                  const expanded = item.kind === 'system' && expandedNotifId === item.id;
                  return (
                    <SwipeableRow
                      key={item.id}
                      onMarkRead={item.unread ? () => (item.kind === 'message' ? markThreadReadFor(item.jobId) : markNotificationRead(item.notifId)) : null}
                      onDismiss={item.kind === 'system' ? () => dismissNotification(item.notifId) : null}
                    >
                      <button className="entity-mobile-row inbox-row" onClick={() => handleRowTap(item)}>
                        {item.unread && <span className="entity-mobile-row-dot warn" aria-hidden="true" />}
                        <span className="entity-mobile-row-text">
                          <span className="entity-mobile-row-title">
                            {item.kind === 'message' ? item.title : 'System'}
                            {item.jobNumber ? ` · #${item.jobNumber}` : ''}
                          </span>
                          <span className={`entity-mobile-row-sub ${expanded ? '' : 'inbox-row-clamp'}`}>{item.preview}</span>
                          {expanded && (
                            <span className="inbox-row-expanded-actions" onClick={e => e.stopPropagation()}>
                              {item.jobId && <Link href={`/jobs/${item.jobId}`} className="btn btn-sm">View job</Link>}
                              {item.unread && <button type="button" className="btn btn-sm" onClick={() => markNotificationRead(item.notifId)}>Mark read</button>}
                            </span>
                          )}
                        </span>
                        <span className="inbox-row-time">{fmtRelative(item.timestamp)}</span>
                      </button>
                    </SwipeableRow>
                  );
                })}
              </div>
            </>
          )
        ) : (
          <div className="messages-layout">
            <div className="messages-sidebar">
              {threads.length === 0 && <div className="empty-state">No customer messages yet.</div>}
              {threads.map(t => (
                <button
                  key={t.jobId}
                  className={`messages-thread-item ${activeJobId === t.jobId ? 'active' : ''}`}
                  onClick={() => setSelectedJobId(t.jobId)}
                >
                  <div className="messages-thread-name">{t.jobInfo?.customer_name || 'Unnamed'}</div>
                  <div className="messages-thread-job">#{t.jobInfo?.job_number}</div>
                  <div className="messages-thread-preview">{t.last.message}</div>
                  {t.unreadCount > 0 && <span className="messages-unread-badge">{t.unreadCount}</span>}
                </button>
              ))}
            </div>

            <div className="messages-chat">
              {!selectedThread ? (
                <div className="empty-state" style={{ padding: 40 }}>Select a conversation.</div>
              ) : (
                <>
                  <div className="messages-chat-header">
                    <div>
                      <div style={{ fontWeight: 700 }}>{selectedThread.jobInfo?.customer_name || 'Unnamed'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Job #{selectedThread.jobInfo?.job_number}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {selectedThread.unreadCount > 0 && (
                        <button className="btn btn-sm" onClick={markThreadRead} disabled={markingRead}>
                          {markingRead ? 'Marking…' : 'Mark as Read'}
                        </button>
                      )}
                      <Link href={`/jobs/${activeJobId}`} className="btn btn-sm">View Job →</Link>
                    </div>
                  </div>

                  <div className="messages-thread-scroll">
                    {selectedThread.msgs.map(m => (
                      <div key={m.id}>
                        <div className={`messages-bubble ${m.sender === 'admin' ? 'from-admin' : 'from-customer'}`}>
                          <div className="messages-bubble-text">{m.message}</div>
                          <div className="messages-bubble-time">{fmtDate(m.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={e => sendReply(e)} className="messages-compose">
                    <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply…" rows={2} />
                    <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .messages-layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; align-items: start; height: calc(100vh - 220px); min-height: 460px; }
        .messages-sidebar { background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; overflow-y: auto; height: 100%; }
        .messages-thread-item { display: block; width: 100%; text-align: left; padding: 12px 16px; border: none; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; position: relative; font-family: inherit; }
        .messages-thread-item.active { background: var(--panel); }
        .messages-thread-name { font-weight: 700; font-size: 13px; color: var(--heading); }
        .messages-thread-job { font-size: 10.5px; color: var(--ink-soft); margin-bottom: 4px; }
        .messages-thread-preview { font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
        .messages-unread-badge { position: absolute; top: 12px; right: 14px; background: var(--rust); color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 10px; padding: 1px 7px; }
        .messages-chat { background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; height: 100%; }
        .messages-chat-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
        .messages-thread-scroll { flex: 1; }
        @media (max-width: 800px) {
          .messages-layout { grid-template-columns: 1fr; height: auto; }
          .messages-sidebar { height: 220px; }
          .messages-chat { height: 500px; }
        }
      `}</style>
    </AppShell>
  );
}
