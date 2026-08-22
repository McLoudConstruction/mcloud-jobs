'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CustomerInboxPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (!selectedJobId) return;
    const load = () => supabase.from('job_questions').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: false }).then(({ data }) => { if (data) setQuestions(data); });
    load();
    const channel = supabase.channel(`portal-inbox-${selectedJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions', filter: `job_id=eq.${selectedJobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [selectedJobId]);

  async function submitQuestion(e) {
    e.preventDefault();
    if (!question.trim() || !selectedJobId) return;
    setSending(true);
    const { error } = await supabase.from('job_questions').insert({
      job_id: selectedJobId,
      customer_email: session.user.email,
      message: question,
    });
    setSending(false);
    if (!error) {
      setQuestion('');
      setFlash('Message sent — we\'ll get back to you soon.');
      setTimeout(() => setFlash(''), 3000);
    }
  }

  if (loading || !session) return null;

  return (
    <CustomerPortalShell>
      <div className="container" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />

        {job && (
          <div className="card">
            <h3>Have a question about your project?</h3>
            <form onSubmit={submitQuestion}>
              <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Fill out your message here" />
              {flash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 8 }}>{flash}</div>}
              <div className="section-actions">
                <button className="btn btn-primary btn-sm" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Submit message'}</button>
              </div>
            </form>

            {questions.length > 0 && (
              <div style={{ marginTop: 20 }}>
                {questions.map(q => (
                  <div className="update-entry" key={q.id}>
                    <div className="update-date">{fmtDate((q.created_at || '').slice(0, 10))}</div>
                    {q.sender === 'admin' ? (
                      <>
                        <div className="update-field-label">McLoud Construction</div>
                        <p>{q.message}</p>
                      </>
                    ) : (
                      <>
                        <p>{q.message}</p>
                        {q.response && <><div className="update-field-label">McLoud Construction replied</div><p>{q.response}</p></>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CustomerPortalShell>
  );
}
