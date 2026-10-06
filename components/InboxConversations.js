'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

// The Inbox: one flat list of conversations, styled like Apple's Messages.
// Every communication the platform sends on a job files here —
//   • each email (documents, invites, RFPs, work orders, reminders, replies you
//     type here) is its own conversation, and replies from the other side file
//     into the conversation they answer;
//   • customer portal chat is one conversation per job;
//   • subcontractor messages are one conversation per company (or per RFP when
//     the message was about a specific request).
// Mail that isn't tied to a job (sub applications, sign-in links) files into the
// overall Inbox (no jobId) under "System".
// Each row shows who it's with, the topic ("Estimate Sent"), and when the last
// message went or came in. Pass jobId to limit it to one project.

function addressOf(v) {
  const first = (v || '').split(',')[0].trim();
  const m = first.match(/<([^>]+)>/);
  return (m ? m[1] : first).trim().toLowerCase();
}

function cleanSubject(subject) {
  return (subject || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\[(?:Project|Job) #[A-Za-z0-9-]+\]\s*/i, '').trim() || '(no subject)';
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
  const body = (m.text || '').replace(/\n{3,}/g, '\n\n').trim();
  const long = body.length > 320 || body.split('\n').length > 7;
  return (
    <div className={`em-row ${m.out ? 'em-out' : 'em-in'}`}>
      <div className="em-bubble">
        {m.subject && <div className="em-subject">{m.subject}</div>}
        <div className={`em-text ${long && !open ? 'em-clamp' : ''}`}>{body || '(no text)'}</div>
        {long && <button type="button" className="em-more" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show more'}</button>}
      </div>
    </div>
  );
}

export default function InboxConversations({ session, jobId = null, job: scopedJob = null }) {
  const [emails, setEmails] = useState([]);
  const [portal, setPortal] = useState([]);
  const [subs, setSubs] = useState([]);
  const [jobsById, setJobsById] = useState({});
  const [companies, setCompanies] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef(null);
  const scopedJobRef = useRef(scopedJob);
  scopedJobRef.current = scopedJob;

  const load = useCallback(async () => {
    // Mail pulled in by the CRM email log (source 'crm_sync') lives on the
    // People, Property and Company records. It only joins the Inbox when it
    // is tied to a job, so the Inbox is not flooded with every conversation.
    let eq = supabase.from('email_messages').select('*').or('source.neq.crm_sync,job_id.not.is.null').order('received_at', { ascending: false }).limit(1000);
    let pq = supabase.from('job_questions').select('*').order('created_at', { ascending: false }).limit(1000);
    let sq = supabase.from('sub_messages').select('*, rfp_recipients(rfps(title, job_id))').order('created_at', { ascending: false }).limit(1000);
    if (jobId) { eq = eq.eq('job_id', jobId); pq = pq.eq('job_id', jobId); }
    const [e, p, s, c] = await Promise.all([
      eq, pq, sq,
      supabase.from('companies').select('id, company_name, contact_email'),
    ]);
    // A sub message belongs to a job directly, or through the RFP it was about.
    const subRows = (s.data || [])
      .map(m => ({ ...m, _job: m.job_id || m.rfp_recipients?.rfps?.job_id || null }))
      .filter(m => (jobId ? m._job === jobId : true));
    setEmails(e.data || []);
    setPortal(p.data || []);
    setSubs(subRows);
    setCompanies(c.data || []);

    const ids = [...new Set([...(e.data || []).map(m => m.job_id), ...(p.data || []).map(m => m.job_id), ...subRows.map(m => m._job)])].filter(Boolean);
    if (ids.length && !jobId) {
      const { data: js } = await supabase.from('jobs').select('id, project_number, customer_name, customer_email, billing_email').in('id', ids);
      setJobsById(Object.fromEntries((js || []).map(j => [j.id, j])));
    } else if (jobId && scopedJobRef.current) {
      setJobsById({ [jobId]: { id: jobId, ...scopedJobRef.current } });
    }
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`inbox-${jobId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_messages' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, jobId]);

  const conversations = useMemo(() => {
    const convs = [];
    const nameFor = (jid, address) => {
      const j = (jid && jobsById[jid]) || {};
      if ([j.customer_email, j.billing_email].some(x => (x || '').toLowerCase() === address) && j.customer_name) return j.customer_name;
      const co = companies.find(x => (x.contact_email || '').toLowerCase() === address);
      return co?.company_name || address;
    };

    // Email — every send starts its own conversation; replies (inbound, or our
    // own "Re:") file into the latest conversation with that person on that
    // subject.
    const latestByThread = new Map();
    const asc = [...emails].sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
    for (const m of asc) {
      const out = m.direction === 'outbound';
      const address = addressOf(out ? m.to_email : m.from_email);
      if (!address) continue;
      const tkey = `${m.thread_key || m.job_id || 'system'}|${address}`;
      const isReply = !out || /^\s*(re|fwd?|fw)\s*:/i.test(m.subject || '');
      let conv = isReply ? latestByThread.get(tkey) : null;
      if (!conv) {
        conv = {
          key: `email:${m.id}`, channel: 'email', jobId: m.job_id, address,
          name: nameFor(m.job_id, address),
          topic: m.topic || cleanSubject(m.subject),
          msgs: [],
        };
        latestByThread.set(tkey, conv);
        convs.push(conv);
      }
      conv.msgs.push({
        id: m.id, out, at: m.received_at, subject: cleanSubject(m.subject),
        text: m.body_text || m.snippet || '', unread: !out && !m.read,
      });
    }

    // Customer portal chat — one conversation per job.
    const portalByJob = new Map();
    for (const m of [...portal].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
      let conv = portalByJob.get(m.job_id);
      if (!conv) {
        const j = jobsById[m.job_id] || {};
        conv = { key: `portal:${m.job_id}`, channel: 'portal', jobId: m.job_id, address: m.customer_email || j.customer_email || '', name: j.customer_name || m.customer_email || 'Customer', topic: 'Portal Messages', msgs: [] };
        portalByJob.set(m.job_id, conv);
        convs.push(conv);
      }
      conv.msgs.push({ id: m.id, out: m.sender === 'admin', at: m.created_at, text: m.message, unread: m.sender === 'customer' && !m.read_at });
    }

    // Subcontractor messages — one per company, or per RFP when it was about one.
    const subByKey = new Map();
    for (const m of [...subs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
      const k = `${m.company_id}|${m.rfp_recipient_id || 'general'}`;
      let conv = subByKey.get(k);
      if (!conv) {
        const co = companies.find(x => x.id === m.company_id);
        const rfpTitle = m.rfp_recipients?.rfps?.title;
        conv = {
          key: `sub:${k}`, channel: 'sub', jobId: m._job, companyId: m.company_id, rfpRecipientId: m.rfp_recipient_id || null,
          address: co?.contact_email || '', name: co?.company_name || 'Subcontractor',
          topic: rfpTitle ? `RFP: ${rfpTitle}` : 'Sub Messages', msgs: [],
        };
        subByKey.set(k, conv);
        convs.push(conv);
      }
      conv.msgs.push({ id: m.id, out: m.sender === 'staff', at: m.created_at, text: m.message, unread: m.sender === 'sub' && !m.read_at });
    }

    return convs.map(c => {
      c.msgs.sort((a, b) => new Date(a.at) - new Date(b.at));
      return { ...c, last: c.msgs[c.msgs.length - 1], unread: c.msgs.filter(m => m.unread).length, project: jobsById[c.jobId]?.project_number || null };
    }).sort((a, b) => new Date(b.last.at) - new Date(a.last.at));
  }, [emails, portal, subs, jobsById, companies]);

  const selected = conversations.find(c => c.key === selectedKey) || null;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedKey, selected?.msgs.length]);

  async function open(c) {
    setSelectedKey(c.key);
    setReply('');
    setError('');
    const ids = c.msgs.filter(m => m.unread).map(m => m.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    if (c.channel === 'email') await supabase.from('email_messages').update({ read: true }).in('id', ids);
    else if (c.channel === 'portal') await supabase.from('job_questions').update({ read_at: now }).in('id', ids);
    else await supabase.from('sub_messages').update({ read_at: now }).in('id', ids);
    load();
  }

  async function send(e) {
    e.preventDefault();
    if (!selected || !reply.trim() || sending) return;
    const text = reply.trim();
    setSending(true);
    setError('');
    try {
      if (selected.channel === 'email') {
        const lastSubject = selected.last.subject || selected.topic;
        const subject = /^\s*re\s*:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}`;
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: selected.address, subject, text, topic: selected.topic,
            html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
            category: 'job_email', jobId: selected.jobId, sentBy: session?.user?.email || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send.');
      } else if (selected.channel === 'portal') {
        const { error: insErr } = await supabase.from('job_questions').insert({
          job_id: selected.jobId, customer_email: selected.address || null, sender: 'admin', message: text,
        });
        if (insErr) throw new Error(insErr.message);
        const now = new Date().toISOString();
        const unanswered = portal.filter(m => m.job_id === selected.jobId && m.sender === 'customer' && !m.responded_at).map(m => m.id);
        if (unanswered.length) await supabase.from('job_questions').update({ responded_at: now, read_at: now }).in('id', unanswered);
      } else {
        const { error: insErr } = await supabase.from('sub_messages').insert({
          company_id: selected.companyId, job_id: selected.jobId || null, rfp_recipient_id: selected.rfpRecipientId,
          sender: 'staff', sender_email: session?.user?.email || null, message: text,
        });
        if (insErr) throw new Error(insErr.message);
      }
      setReply('');
      await load();
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  // Deletes every message in the open conversation from the table its channel
  // lives in. Customer portal and sub messages are also seen by the other side,
  // so the confirm says they will disappear there too.
  async function deleteConversation() {
    if (!selected || deleting) return;
    const table = selected.channel === 'email' ? 'email_messages' : selected.channel === 'portal' ? 'job_questions' : 'sub_messages';
    const ids = selected.msgs.map(m => m.id);
    const count = ids.length;
    const shared = selected.channel === 'portal' ? ' The customer will no longer see them in their portal.' : selected.channel === 'sub' ? ' The subcontractor will no longer see them in their portal.' : '';
    if (!confirm(`Delete this conversation? ${count === 1 ? 'The 1 message in it' : `All ${count} messages in it`} will be permanently deleted.${shared} This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    // select('id') returns the rows actually removed, so a delete that RLS
    // silently blocked (zero rows) is reported instead of looking like success.
    const { data, error: delErr } = await supabase.from(table).delete().in('id', ids).select('id');
    if (delErr || (data || []).length === 0) {
      setError(`Delete failed: ${delErr?.message || 'no messages were removed.'}`);
      setDeleting(false);
      return;
    }
    setSelectedKey(null);
    setReply('');
    await load();
    setDeleting(false);
  }

  if (!loaded) return <div className="empty-state">Loading…</div>;

  return (
    <div className={`em-shell ${selected ? 'em-chat-open' : ''}`}>
      <aside className="em-list">
        <div className="em-list-title">Inbox</div>
        {conversations.length === 0 && <div className="empty-state" style={{ padding: 20 }}>No conversations yet. Everything sent from a project — emails, RFPs, portal and sub messages — shows up here.</div>}
        {conversations.map(c => (
          <button key={c.key} type="button" className={`em-item ${selectedKey === c.key ? 'active' : ''}`} onClick={() => open(c)}>
            <span className="em-dot-col">{c.unread > 0 && <span className="em-unread" aria-label="Unread" />}</span>
            <span className="em-item-body">
              <span className="em-item-top">
                <span className="em-item-name">{c.name}</span>
                <span className="em-item-time">{listTime(c.last.at)}</span>
              </span>
              <span className="em-item-topic">{!jobId ? (c.project ? `#${c.project} · ` : 'System · ') : ''}{c.topic}</span>
            </span>
          </button>
        ))}
      </aside>

      <section className="em-chat">
        {!selected ? (
          <div className="em-empty">Select a conversation</div>
        ) : (
          <>
            <header className="em-chat-head">
              <button type="button" className="em-back" onClick={() => setSelectedKey(null)}>‹ Inbox</button>
              <div className="em-head-center">
                <div className="em-head-name">{selected.name}</div>
                <div className="em-head-sub">{selected.topic}</div>
              </div>
              <div className="em-head-actions">
                {!jobId && selected.jobId && <Link href={`/jobs/${selected.jobId}`} className="em-job-link">Job</Link>}
                <button type="button" className="em-delete" onClick={deleteConversation} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
              </div>
            </header>

            <div className="em-scroll" ref={scrollRef}>
              {selected.msgs.map((m, i) => {
                const prev = selected.msgs[i - 1];
                const showStamp = !prev || new Date(m.at) - new Date(prev.at) > 60 * 60 * 1000;
                return (
                  <div key={m.id}>
                    {showStamp && <div className="em-stamp">{stamp(m.at)}</div>}
                    <Bubble m={m} />
                  </div>
                );
              })}
              {selected.last.out && <div className="em-delivered">Sent {stamp(selected.last.at)}</div>}
            </div>

            <form className="em-compose" onSubmit={send}>
              <textarea
                rows={1}
                value={reply}
                placeholder={selected.channel === 'email' ? 'Email' : 'Message'}
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
        .em-item { display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; padding: 10px 16px 10px 6px; border: none; background: transparent; cursor: pointer; font-family: inherit; }
        .em-item:hover { background: var(--panel); }
        .em-item.active { background: #0a84ff; }
        .em-item.active .em-item-name, .em-item.active .em-item-time, .em-item.active .em-item-topic { color: #fff; }
        .em-item-body { flex: 1; min-width: 0; display: block; border-bottom: 1px solid var(--line); padding-bottom: 9px; margin-bottom: -9px; }
        .em-item.active .em-item-body { border-bottom-color: transparent; }
        .em-dot-col { width: 14px; flex-shrink: 0; display: flex; justify-content: center; }
        .em-unread { width: 9px; height: 9px; border-radius: 50%; background: #0a84ff; display: block; }
        .em-item.active .em-unread { background: #fff; }
        .em-item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .em-item-name { font-weight: 600; font-size: 14.5px; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-item-time { font-size: 12px; color: var(--ink-soft); flex-shrink: 0; }
        .em-item-topic { display: block; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
        .em-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--card-bg); }
        .em-empty { margin: auto; color: var(--ink-soft); font-size: 14px; }
        .em-chat-head { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
        .em-back { display: none; justify-self: start; border: none; background: none; color: #0a84ff; font-size: 16px; cursor: pointer; padding: 6px 0; font-family: inherit; }
        .em-head-center { grid-column: 2; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }
        .em-head-name { font-size: 14px; font-weight: 600; color: var(--heading); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-head-sub { font-size: 12px; color: var(--ink-soft); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .em-head-actions { grid-column: 3; justify-self: end; display: flex; align-items: center; gap: 12px; }
        .em-job-link { font-size: 13px; color: #0a84ff; text-decoration: none; }
        .em-delete { border: none; background: none; padding: 6px 0; font: inherit; font-size: 13px; color: #d70015; cursor: pointer; }
        .em-delete:disabled { opacity: 0.5; cursor: default; }
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
