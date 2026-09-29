'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { normalizeSubjectForThread, threadKeyFor } from '../lib/emailThreading';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtShort(v) {
  if (!v) return '';
  const d = new Date(v);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Drops a leading "Re:"/"Fwd:" and the [Project #…] tag for display — the
// tag is on every subject, so showing it in the list is just noise next to
// the project number the row already carries.
function cleanSubject(subject) {
  return (subject || '(no subject)').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\[(?:Project|Job) #[A-Za-z0-9-]+\]\s*/i, '').trim() || '(no subject)';
}

// Inbox → Email: every email sent from the platform on a job (document
// sends, invites, automations, replies typed here) and every reply the mail
// sync files back, grouped into one conversation per job + subject. A reply
// lands in the same conversation as the message it answers because both share
// a thread_key (see lib/emailThreading.js).
export default function EmailConversations({ session }) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('email_messages').select('*, jobs(project_number, customer_name)')
      .not('job_id', 'is', null).order('received_at', { ascending: false }).limit(1000);
    setMessages(data || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('inbox-email-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const threads = useMemo(() => {
    const byKey = new Map();
    for (const m of messages) {
      const key = m.thread_key || threadKeyFor(m.job_id, m.subject);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { key, jobId: m.job_id, job: m.jobs, msgs: [] });
      byKey.get(key).msgs.push(m);
    }
    return [...byKey.values()].map(t => {
      t.msgs.sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
      const last = t.msgs[t.msgs.length - 1];
      return { ...t, last, subject: cleanSubject(t.msgs[0].subject), unread: t.msgs.filter(m => m.direction === 'inbound' && !m.read).length };
    }).sort((a, b) => new Date(b.last.received_at) - new Date(a.last.received_at));
  }, [messages]);

  const selected = threads.find(t => t.key === selectedKey) || null;

  async function open(t) {
    setSelectedKey(t.key);
    setReply('');
    setError('');
    const unreadIds = t.msgs.filter(m => m.direction === 'inbound' && !m.read).map(m => m.id);
    if (unreadIds.length) {
      await supabase.from('email_messages').update({ read: true }).in('id', unreadIds);
      load();
    }
  }

  async function send(e) {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    const last = selected.last;
    const to = last.direction === 'inbound'
      ? last.from_email
      : [...selected.msgs].reverse().find(m => m.direction === 'outbound')?.to_email;
    if (!to) { setError('No recipient address on this conversation.'); return; }
    setSending(true);
    setError('');
    try {
      const subject = /^\s*re\s*:/i.test(last.subject || '') ? last.subject : `Re: ${last.subject || selected.subject}`;
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to, subject, text: reply, html: reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
          category: 'job_email', jobId: selected.jobId, sentBy: session?.user?.email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setReply('');
      await load();
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  if (!loaded) return <div className="empty-state">Loading email…</div>;

  return (
    <div className="messages-layout">
      <div className="messages-sidebar">
        {threads.length === 0 && <div className="empty-state" style={{ padding: 16 }}>No email conversations yet. Every email sent from a project shows up here.</div>}
        {threads.map(t => (
          <button key={t.key} className={`messages-thread-item ${selectedKey === t.key ? 'active' : ''}`} onClick={() => open(t)}>
            <div className="messages-thread-name" style={{ paddingRight: 40 }}>{t.job?.customer_name || 'Unnamed'}</div>
            <div className="messages-thread-job">{t.job?.project_number ? `#${t.job.project_number} · ` : ''}{fmtShort(t.last.received_at)}{t.msgs.length > 1 ? ` · ${t.msgs.length} messages` : ''}</div>
            <div className="messages-thread-preview" style={{ fontWeight: t.unread ? 700 : 400 }}>{t.subject}</div>
            {t.unread > 0 && <span className="messages-unread-badge">{t.unread}</span>}
          </button>
        ))}
      </div>

      <div className="messages-chat">
        {!selected ? (
          <div className="empty-state" style={{ padding: 40 }}>Select a conversation.</div>
        ) : (
          <>
            <div className="messages-chat-header">
              <div>
                <div style={{ fontWeight: 700 }}>{selected.subject}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{selected.job?.customer_name || 'Unnamed'}{selected.job?.project_number ? ` · Project #${selected.job.project_number}` : ''}</div>
              </div>
              <Link href={`/jobs/${selected.jobId}`} className="btn btn-sm">View Job →</Link>
            </div>
            <div className="messages-thread-scroll" style={{ overflowY: 'auto' }}>
              {selected.msgs.map(m => (
                <div key={m.id}>
                  <div className={`messages-bubble ${m.direction === 'outbound' ? 'from-admin' : 'from-customer'}`}>
                    <div style={{ fontSize: 10.5, opacity: 0.75, marginBottom: 2 }}>
                      {m.direction === 'outbound' ? `To ${m.to_email || ''}` : `From ${m.from_email || ''}`}
                    </div>
                    <div className="messages-bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{m.body_text || m.snippet || '(no text)'}</div>
                    <div className="messages-bubble-time">{fmtDate(m.received_at)}</div>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="messages-compose">
              <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply by email…" rows={2} />
              <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
            </form>
            {error && <div className="error-text" style={{ padding: '0 18px 12px' }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
