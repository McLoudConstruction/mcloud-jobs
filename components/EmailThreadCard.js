'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Shows the job's email thread — every outbound send that carried this
// jobId, plus any inbound reply the sync cron filed here by reading the
// [Job #...] tag back out of its subject. Not a general inbox: this
// only ever shows mail already tied to this one job.
export default function EmailThreadCard({ jobId, job }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState(job?.billing_email || job?.customer_email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('email_messages').select('*').eq('job_id', jobId).order('received_at', { ascending: true });
    if (data) setMessages(data);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`email-thread-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function send(e) {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, text: body, html: body.replace(/\n/g, '<br>'), category: 'job_email', jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setSubject('');
      setBody('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="card"><div className="empty-state">Loading email…</div></div>;

  return (
    <div className="card">
      <h3>Email</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Every email sent from this job, and any reply that comes back — replies are matched by the job number
        tag ([Job #{job?.job_number}]) in the subject line, synced every couple hours.
      </div>

      {messages.length === 0 && <div className="empty-state">No email on this job yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {messages.map(m => (
          <div
            key={m.id}
            style={{
              alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.direction === 'outbound' ? 'var(--sidebar-active-bg)' : 'var(--panel)',
              color: m.direction === 'outbound' ? 'var(--sidebar-active-text)' : 'var(--ink)',
              border: '1px solid var(--panel-line)',
              borderRadius: 8,
              padding: '10px 14px',
            }}
          >
            <div style={{ fontSize: 10.5, opacity: 0.75, marginBottom: 3 }}>
              {m.direction === 'outbound' ? `To ${m.to_email}` : `From ${m.from_email}`} · {fmtDate(m.received_at)}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{m.subject}</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.body_text || m.snippet}</div>
          </div>
        ))}
      </div>

      <form onSubmit={send} style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <label>To</label>
        <input type="email" value={to} onChange={e => setTo(e.target.value)} required />
        <label>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Will be tagged with the job number automatically" required />
        <label>Message</label>
        <textarea rows={4} value={body} onChange={e => setBody(e.target.value)} required />
        {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={sending} style={{ marginTop: 10 }}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
