'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtMsgDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function JobMessagesCard({ jobId, job }) {
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(() => {
    supabase.from('job_questions').select('*').eq('job_id', jobId).order('created_at', { ascending: true }).then(({ data }) => { if (data) setMsgs(data); });
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`job-messages-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function send(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setSendError('');
    const { error: insertError } = await supabase.from('job_questions').insert({
      job_id: jobId,
      customer_email: job.customer_email || job.billing_email || null,
      sender: 'admin',
      message: reply.trim(),
    });
    if (insertError) {
      setSending(false);
      setSendError(insertError.message);
      return;
    }
    const unanswered = msgs.filter(m => m.sender === 'customer' && !m.responded_at);
    if (unanswered.length > 0) {
      const now = new Date().toISOString();
      await supabase.from('job_questions').update({ responded_at: now, read_at: now }).in('id', unanswered.map(m => m.id));
    }
    setReply('');
    setSending(false);
    // Don't rely solely on the realtime subscription — refresh directly
    // so the sent message shows up immediately.
    await load();
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <h3 style={{ margin: 0 }}>Messages</h3>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
          {msgs.length === 0
            ? "No messages with this customer yet — send the first one below."
            : `Conversation with ${job.customer_name || 'this customer'}.`}
        </div>
      </div>

      <div className="messages-thread-scroll" style={{ minHeight: 200, maxHeight: 420 }}>
        {msgs.length === 0 && <div className="empty-state" style={{ padding: 20 }}>No messages yet.</div>}
        {msgs.map(m => (
          <div key={m.id}>
            <div className={`messages-bubble ${m.sender === 'admin' ? 'from-admin' : 'from-customer'}`}>
              <div className="messages-bubble-text">{m.message}</div>
              <div className="messages-bubble-time">{fmtMsgDate(m.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="messages-compose">
        <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder={`Message ${job.customer_name || 'the customer'}…`} rows={2} />
        <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
      {sendError && <div style={{ fontSize: 12, color: '#a13f3f', padding: '0 18px 14px' }}>{sendError}</div>}
    </div>
  );
}
