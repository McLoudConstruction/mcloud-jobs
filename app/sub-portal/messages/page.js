'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';

function fmtDateTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SubPortalMessagesPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, jobsById, ready } = useSubPortalData(session);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [jobId, setJobId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (companyId) => {
    const { data } = await supabase.from('sub_messages').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    if (data) setMessages(data);
  }, []);

  useEffect(() => {
    if (!company) return;
    load(company.id);
    supabase.rpc('mark_staff_messages_read', { target_company_id: company.id }).then(() => {});
    const channel = supabase.channel(`sub-portal-messages-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_messages', filter: `company_id=eq.${company.id}` }, () => load(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, load]);

  async function submitMessage(e) {
    e.preventDefault();
    if (!text.trim() || !company) return;
    setSending(true);
    setError('');
    const { error: rpcErr } = await supabase.rpc('send_sub_message', {
      target_company_id: company.id,
      target_job_id: jobId || null,
      message_in: text.trim(),
    });
    setSending(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setText('');
  }

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  const jobOptions = Object.values(jobsById);

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="card" style={{ padding: '4px 24px' }}>
          <div className="dash-section" style={{ paddingTop: 18 }}>
            <h3>Send a Message</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
              Questions about a work order, scheduling, anything — this goes straight to the office.
            </div>
            <form onSubmit={submitMessage}>
              {jobOptions.length > 0 && (
                <>
                  <label htmlFor="msgJob">Which project is this about? (optional)</label>
                  <select id="msgJob" value={jobId} onChange={e => setJobId(e.target.value)} style={{ marginBottom: 10 }}>
                    <option value="">General question</option>
                    {jobOptions.map(j => (
                      <option key={j.id} value={j.id}>{j.project_address || `Job #${j.job_number}`}</option>
                    ))}
                  </select>
                </>
              )}
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Type your message…" />
              {error && <div className="error-text" style={{ marginTop: 6 }}>{error}</div>}
              <div className="section-actions">
                <button className="btn btn-primary btn-sm" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
              </div>
            </form>
          </div>

          <div className="dash-section">
            <h3>Conversation</h3>
            {messages.length === 0 && <div className="empty-state">No messages yet.</div>}
            {messages.map(m => (
              <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: m.sender === 'staff' ? 'var(--gold)' : 'var(--ink)' }}>
                    {m.sender === 'staff' ? 'McLoud Construction' : 'You'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', flexShrink: 0 }}>{fmtDateTime(m.created_at)}</span>
                </div>
                {m.job_id && jobsById[m.job_id] && (
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                    Re: {jobsById[m.job_id].project_address || `Job #${jobsById[m.job_id].job_number}`}
                  </div>
                )}
                <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SubPortalShell>
  );
}
