'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

// Email, laid out like Apple's Messages: a list of conversations (one per
// person, per project), and tapping one opens the whole back-and-forth as chat
// bubbles — blue on the right for what we sent, gray on the left for replies —
// with a reply bar at the bottom. Every email sent from a job (document sends,
// invites, automations, replies typed here) and every reply the mail sync files
// back shows up here. Pass jobId to limit it to one project (the job's Inbox).

function addressOf(v) {
  const first = (v || '').split(',')[0].trim();
  const m = first.match(/<([^>]+)>/);
  return (m ? m[1] : first).trim().toLowerCase();
}

function cleanSubject(subject) {
  return (subject || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\[(?:Project|Job) #[A-Za-z0-9-]+\]\s*/i, '').trim() || '(no subject)';
}

function initials(name) {
  const parts = (name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function listTime(v) {
  const d = new Date(v);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// The centered gray timestamp Messages puts between bubbles that are more
// than a little apart.
function stamp(v) {
  const d = new Date(v);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

function Bubble({ m }) {
  const [open, setOpen] = useState(false);
  const out = m.direction === 'outbound';
  const body = (m.body_text || m.snippet || '').replace(/\n{3,}/g, '\n\n').trim();
  const long = body.length > 320 || body.split('\n').length > 7;
  return (
    <div className={`em-row ${out ? 'em-out' : 'em-in'}`}>
      <div className="em-bubble">
        <div className="em-subject">{cleanSubject(m.subject)}</div>
        <div className={`em-text ${long && !open ? 'em-clamp' : ''}`}>{body || '(no text)'}</div>
        {long && <button type="button" className="em-more" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show more'}</button>}
      </div>
    </div>
  );
}

export default function EmailConversations({ session, jobId = null, job: scopedJob = null }) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    let q = supabase.from('email_messages').select('*, jobs(project_number, customer_name, customer_email, billing_email)')
      .not('job_id', 'is', null).order('received_at', { ascending: false }).limit(1000);
    if (jobId) q = q.eq('job_id', jobId);
    const { data } = await q;
    setMessages(data || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`inbox-email-${jobId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, jobId]);

  const threads = useMemo(() => {
    const byKey = new Map();
    for (const m of messages) {
      const who = addressOf(m.direction === 'outbound' ? m.to_email : m.from_email);
      if (!who) continue;
      const key = `${m.job_id}|${who}`;
      if (!byKey.has(key)) byKey.set(key, { key, jobId: m.job_id, job: m.jobs || scopedJob, address: who, msgs: [] });
      byKey.get(key).msgs.push(m);
    }
    return [...byKey.values()].map(t => {
      t.msgs.sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
      const j = t.job || {};
      const isCustomer = [j.customer_email, j.billing_email].some(e => (e || '').toLowerCase() === t.address);
      return {
        ...t,
        last: t.msgs[t.msgs.length - 1],
        name: isCustomer && j.customer_name ? j.customer_name : t.address,
        unread: t.msgs.filter(m => m.direction === 'inbound' && !m.read).length,
      };
    }).sort((a, b) => new Date(b.last.received_at) - new Date(a.last.received_at));
  }, [messages, scopedJob]);

  const selected = threads.find(t => t.key === selectedKey) || null;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedKey, selected?.msgs.length]);

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
    if (!selected || !reply.trim() || sending) return;
    const last = selected.last;
    const subject = /^\s*re\s*:/i.test(last.subject || '') ? last.subject : `Re: ${last.subject || 'Your project'}`;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selected.address, subject, text: reply.trim(),
          html: reply.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
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
    <div className={`em-shell ${selected ? 'em-chat-open' : ''}`}>
      <aside className="em-list">
        <div className="em-list-title">Email</div>
        {threads.length === 0 && <div className="empty-state" style={{ padding: 20 }}>No email conversations yet. Every email sent from a project shows up here.</div>}
        {threads.map(t => {
          const out = t.last.direction === 'outbound';
          return (
            <button key={t.key} type="button" className={`em-item ${selectedKey === t.key ? 'active' : ''}`} onClick={() => open(t)}>
              <span className="em-dot-col">{t.unread > 0 && <span className="em-unread" aria-label="Unread" />}</span>
              <span className="em-avatar">{initials(t.name)}</span>
              <span className="em-item-body">
                <span className="em-item-top">
                  <span className="em-item-name">{t.name}</span>
                  <span className="em-item-time">{listTime(t.last.received_at)}</span>
                </span>
                <span className="em-item-project">{t.job?.project_number ? `#${t.job.project_number}` : ''}</span>
                <span className="em-item-preview">{out ? 'You: ' : ''}{cleanSubject(t.last.subject)}</span>
              </span>
            </button>
          );
        })}
      </aside>

      <section className="em-chat">
        {!selected ? (
          <div className="em-empty">Select a conversation</div>
        ) : (
          <>
            <header className="em-chat-head">
              <button type="button" className="em-back" onClick={() => setSelectedKey(null)}>‹ Email</button>
              <div className="em-head-center">
                <span className="em-avatar em-avatar-sm">{initials(selected.name)}</span>
                <div className="em-head-name">{selected.name}</div>
                <div className="em-head-sub">{selected.job?.project_number ? `#${selected.job.project_number} · ` : ''}{selected.address}</div>
              </div>
              <Link href={`/jobs/${selected.jobId}`} className="em-job-link">Job</Link>
            </header>

            <div className="em-scroll" ref={scrollRef}>
              {selected.msgs.map((m, i) => {
                const prev = selected.msgs[i - 1];
                const showStamp = !prev || new Date(m.received_at) - new Date(prev.received_at) > 60 * 60 * 1000;
                return (
                  <div key={m.id}>
                    {showStamp && <div className="em-stamp">{stamp(m.received_at)}</div>}
                    <Bubble m={m} />
                  </div>
                );
              })}
              {selected.last.direction === 'outbound' && <div className="em-delivered">Sent {stamp(selected.last.received_at)}</div>}
            </div>

            <form className="em-compose" onSubmit={send}>
              <textarea
                rows={1}
                value={reply}
                placeholder="Email"
                onChange={e => { setReply(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
              />
              <button type="submit" className="em-send" disabled={sending || !reply.trim()} aria-label="Send">{sending ? '…' : '↑'}</button>
            </form>
            {error && <div className="em-error">{error}</div>}
          </>
        )}
      </section>

      <style jsx global>{`
        .em-shell { display: grid; grid-template-columns: 340px 1fr; height: calc(100vh - 250px); min-height: 480px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
        .em-list { border-right: 1px solid var(--line); overflow-y: auto; }
        .em-list-title { font-size: 22px; font-weight: 700; padding: 16px 18px 8px; color: var(--heading); }
        .em-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 14px 10px 6px; border: none; background: transparent; cursor: pointer; font-family: inherit; position: relative; }
        .em-item:hover { background: var(--panel); }
        .em-item.active { background: #0a84ff; }
        .em-item.active .em-item-name, .em-item.active .em-item-time, .em-item.active .em-item-preview, .em-item.active .em-item-project { color: #fff; }
        .em-item-body { flex: 1; min-width: 0; display: block; border-bottom: 1px solid var(--line); padding-bottom: 9px; margin-bottom: -9px; }
        .em-item.active .em-item-body { border-bottom-color: transparent; }
        .em-dot-col { width: 12px; flex-shrink: 0; display: flex; justify-content: center; }
        .em-unread { width: 9px; height: 9px; border-radius: 50%; background: #0a84ff; display: block; }
        .em-item.active .em-unread { background: #fff; }
        .em-avatar { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 15px; color: #fff; background: linear-gradient(180deg, #a5abb8, #858b98); }
        .em-avatar-sm { width: 40px; height: 40px; font-size: 14px; }
        .em-item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .em-item-name { font-weight: 600; font-size: 14px; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-item-time { font-size: 12px; color: var(--ink-soft); flex-shrink: 0; }
        .em-item-project { display: block; font-size: 11px; color: var(--ink-soft); min-height: 14px; }
        .em-item-preview { display: block; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--card-bg); }
        .em-empty { margin: auto; color: var(--ink-soft); font-size: 14px; }
        .em-chat-head { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
        .em-back { display: none; justify-self: start; border: none; background: none; color: #0a84ff; font-size: 16px; cursor: pointer; padding: 6px 0; font-family: inherit; }
        .em-head-center { grid-column: 2; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }
        .em-head-name { font-size: 12.5px; font-weight: 600; color: var(--heading); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-head-sub { font-size: 11px; color: var(--ink-soft); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-job-link { grid-column: 3; justify-self: end; font-size: 13px; color: #0a84ff; text-decoration: none; }
        .em-scroll { flex: 1; overflow-y: auto; padding: 14px 16px 6px; }
        .em-stamp { text-align: center; font-size: 11.5px; color: var(--ink-soft); margin: 14px 0 8px; }
        .em-row { display: flex; margin: 2px 0; }
        .em-row.em-out { justify-content: flex-end; }
        .em-bubble { max-width: 74%; padding: 8px 13px; border-radius: 18px; font-size: 14.5px; line-height: 1.35; word-break: break-word; }
        .em-in .em-bubble { background: #e9e9eb; color: #111; border-bottom-left-radius: 5px; }
        .em-out .em-bubble { background: #0a84ff; color: #fff; border-bottom-right-radius: 5px; }
        .em-subject { font-weight: 700; margin-bottom: 3px; }
        .em-text { white-space: pre-wrap; }
        .em-clamp { display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }
        .em-more { border: none; background: none; padding: 4px 0 0; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; color: inherit; opacity: 0.85; text-decoration: underline; }
        .em-delivered { text-align: right; font-size: 11px; color: var(--ink-soft); margin: 3px 4px 8px; }
        .em-compose { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
        .em-compose textarea { flex: 1; resize: none; border: 1px solid var(--line); border-radius: 18px; padding: 8px 14px; font: inherit; font-size: 14.5px; line-height: 1.3; max-height: 140px; background: var(--card-bg); color: var(--ink); margin: 0; }
        .em-send { width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%; border: none; background: #0a84ff; color: #fff; font-size: 18px; font-weight: 700; cursor: pointer; line-height: 1; margin-bottom: 2px; }
        .em-send:disabled { background: #c7c7cc; cursor: default; }
        .em-error { color: #a13f3f; font-size: 12px; padding: 0 16px 10px; }
        @media (max-width: 800px) {
          .em-shell { grid-template-columns: 1fr; height: calc(100vh - 220px); }
          .em-shell .em-chat { display: none; }
          .em-shell.em-chat-open .em-list { display: none; }
          .em-shell.em-chat-open .em-chat { display: flex; }
          .em-back { display: block; }
          .em-bubble { max-width: 84%; }
        }
      `}</style>
    </div>
  );
}
