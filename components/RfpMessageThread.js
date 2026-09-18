'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtMessageTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A conversation coded to one specific rfp_recipient row — used on both
// the Sub Portal's own RFP detail page and the staff RFP detail page's
// per-recipient block, so a question asked from an RFP shows up tagged
// to that RFP rather than landing in the general company thread. Same
// sub_messages table as the company-wide Messages panels, filtered by
// rfp_recipient_id instead of (or in addition to) company_id.
//
// `viewer` decides which side of the conversation this render is: 'sub'
// sends as sender='sub' via the send_sub_message RPC (keeps the RLS/
// notification behavior the general sub-side Messages page already has);
// 'staff' sends as sender='staff' via a plain insert (staff already has
// full read/write on sub_messages through the admin policy).
export default function RfpMessageThread({ recipientId, companyId, jobId, viewer }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sub_messages')
      .select('*')
      .eq('rfp_recipient_id', recipientId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  }, [recipientId]);

  useEffect(() => {
    load();
    const markRead = viewer === 'staff' ? 'mark_sub_messages_read' : 'mark_staff_messages_read';
    supabase.rpc(markRead, { target_company_id: companyId }).then(() => {});
    const channel = supabase.channel(`rfp-messages-${recipientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_messages', filter: `rfp_recipient_id=eq.${recipientId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [recipientId, companyId, viewer, load]);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError('');
    let failMessage = '';
    if (viewer === 'staff') {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insertErr } = await supabase.from('sub_messages').insert({
        company_id: companyId,
        job_id: jobId || null,
        rfp_recipient_id: recipientId,
        sender: 'staff',
        sender_email: user?.email,
        message: text.trim(),
      });
      if (insertErr) failMessage = insertErr.message;
    } else {
      const { error: rpcErr } = await supabase.rpc('send_sub_message', {
        target_company_id: companyId,
        target_job_id: jobId || null,
        message_in: text.trim(),
        target_rfp_recipient_id: recipientId,
      });
      if (rpcErr) failMessage = rpcErr.message;
    }
    setSending(false);
    if (failMessage) { setError(failMessage); return; }
    setText('');
  }

  if (messages === null) return null;

  return (
    <div>
      <form onSubmit={submit} style={{ marginBottom: 12 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={2}
          placeholder={viewer === 'staff' ? 'Message this subcontractor about this request…' : 'Ask a question about this request…'}
        />
        {error && <div className="error-text" style={{ marginTop: 4 }}>{error}</div>}
        <div className="section-actions">
          <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
      {messages.length === 0 && <div className="empty-state">No messages on this request yet.</div>}
      {messages.map(m => (
        <div key={m.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: m.sender === 'staff' ? 'var(--gold)' : 'var(--ink)' }}>
              {m.sender === 'staff'
                ? (viewer === 'staff' ? 'You' : 'McLoud Construction')
                : (viewer === 'staff' ? 'Subcontractor' : 'You')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtMessageTime(m.created_at)}</span>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{m.message}</p>
        </div>
      ))}
    </div>
  );
}
