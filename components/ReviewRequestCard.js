'use client';
import { useState } from 'react';
import { GOOGLE_REVIEW_URL } from '../lib/constants';
import { buildReviewRequestEmail } from '../lib/emailTemplates';

export default function ReviewRequestCard({ job, onSave }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  async function send() {
    // Same recipient precedence every other document email in this app
    // uses (billing_email first, falling back to customer_email) — this
    // was previously reversed here, which could silently send to a
    // different inbox than every other email on the job.
    const to = job.billing_email || job.customer_email || '';
    if (!to) {
      setResult('Add a contact email on the Customer tab before sending.');
      return;
    }
    setSending(true);
    setResult('');
    try {
      const { subject, html, text } = buildReviewRequestEmail({ customerName: job.customer_name, reviewUrl: GOOGLE_REVIEW_URL });
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      await onSave({ review_requested_at: new Date().toISOString() });
      setResult(`Sent to ${to}.`);
    } catch (err) {
      setResult(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h3>Google Review Request</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        {job.review_requested_at
          ? `Sent on ${new Date(job.review_requested_at).toLocaleDateString('en-US')}. You can send it again if you'd like.`
          : "A one-click email asking the customer to leave a Google review — send it whenever feels right, e.g. once the job's wrapped up."}
      </div>
      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={send} disabled={sending}>
          {sending ? 'Sending…' : job.review_requested_at ? 'Send again' : 'Send Review Request'}
        </button>
      </div>
      {result && (
        <div style={{ fontSize: 12, marginTop: 8, color: result.startsWith('Sent') ? '#3a6b45' : '#a13f3f' }}>{result}</div>
      )}
    </div>
  );
}
