'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function MessagesPage() {
  const { session, loading } = useRequireAuth();
  const [questions, setQuestions] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase.from('job_questions').select('*, jobs(job_number, customer_name)').order('created_at', { ascending: true });
    if (data) setQuestions(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadQuestions();
    const channel = supabase.channel('messages-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, loadQuestions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadQuestions]);

  if (loading || !session) return null;

  // Group into one thread per job.
  const threadsByJob = {};
  for (const q of questions) {
    if (!threadsByJob[q.job_id]) threadsByJob[q.job_id] = [];
    threadsByJob[q.job_id].push(q);
  }
  const threads = Object.entries(threadsByJob).map(([jobId, msgs]) => {
    const last = msgs[msgs.length - 1];
    const unreadCount = msgs.filter(m => m.sender === 'customer' && !m.response).length;
    return { jobId, msgs, last, unreadCount, jobInfo: last.jobs };
  }).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

  const selectedThread = threads.find(t => t.jobId === selectedJobId) || threads[0];
  const activeJobId = selectedThread?.jobId;

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim() || !activeJobId) return;
    setSending(true);
    const thread = threadsByJob[activeJobId];
    const customerEmail = thread[0]?.customer_email;

    await supabase.from('job_questions').insert({
      job_id: activeJobId,
      customer_email: customerEmail,
      sender: 'admin',
      message: reply.trim(),
    });

    const unanswered = thread.filter(m => m.sender === 'customer' && !m.response);
    if (unanswered.length > 0) {
      await supabase.from('job_questions').update({ response: reply.trim(), responded_at: new Date().toISOString() }).in('id', unanswered.map(m => m.id));
    }

    setReply('');
    setSending(false);
  }

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Messages</h2>
        </div>

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
                  <Link href={`/jobs/${activeJobId}`} className="btn btn-sm">View Job →</Link>
                </div>

                <div className="messages-thread-scroll">
                  {selectedThread.msgs.map(m => (
                    <div key={m.id}>
                      <div className={`messages-bubble ${m.sender === 'admin' ? 'from-admin' : 'from-customer'}`}>
                        <div className="messages-bubble-text">{m.message}</div>
                        <div className="messages-bubble-time">{fmtDate(m.created_at)}</div>
                      </div>
                      {m.sender === 'customer' && m.response && (
                        <div className="messages-bubble from-admin">
                          <div className="messages-bubble-text">{m.response}</div>
                          <div className="messages-bubble-time">{fmtDate(m.responded_at)}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <form onSubmit={sendReply} className="messages-compose">
                  <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply…" rows={2} />
                  <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .messages-layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; align-items: start; height: calc(100vh - 220px); min-height: 460px; }
        .messages-sidebar { background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow-y: auto; height: 100%; }
        .messages-thread-item { display: block; width: 100%; text-align: left; padding: 12px 16px; border: none; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; position: relative; font-family: inherit; }
        .messages-thread-item.active { background: var(--panel); }
        .messages-thread-name { font-weight: 700; font-size: 13px; color: var(--heading); }
        .messages-thread-job { font-size: 10.5px; color: var(--ink-soft); margin-bottom: 4px; }
        .messages-thread-preview { font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
        .messages-unread-badge { position: absolute; top: 12px; right: 14px; background: var(--rust); color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 10px; padding: 1px 7px; }
        .messages-chat { background: #fff; border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; height: 100%; }
        .messages-chat-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
        .messages-thread-scroll { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
        .messages-bubble { max-width: 70%; padding: 10px 14px; border-radius: 12px; font-size: 13px; }
        .messages-bubble.from-customer { align-self: flex-start; background: var(--panel); border-bottom-left-radius: 3px; }
        .messages-bubble.from-admin { align-self: flex-end; background: var(--rust); color: #fff; border-bottom-right-radius: 3px; }
        .messages-bubble-text { white-space: pre-wrap; }
        .messages-bubble-time { font-size: 10px; opacity: 0.7; margin-top: 4px; }
        .messages-compose { display: flex; gap: 8px; padding: 14px 18px; border-top: 1px solid var(--line); align-items: flex-end; }
        .messages-compose textarea { flex: 1; resize: none; }
        @media (max-width: 800px) {
          .messages-layout { grid-template-columns: 1fr; height: auto; }
          .messages-sidebar { height: 220px; }
          .messages-chat { height: 500px; }
        }
      `}</style>
    </AppShell>
  );
}
