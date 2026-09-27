'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { buildReviewInviteEmail } from '../lib/emailTemplates';
import { supabase } from '../lib/supabaseClient';
import { reviewUrl, holdLabel, REVIEW_STATUS, starText, CATEGORY_LABELS } from '../lib/reviews';

function fmt(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Per-job view of the private review request (migration 138): what state it's
// in, why it's waiting, the customer's answer once it arrives, and the manual
// controls (send now, skip, turn off for this project).
export default function ReviewRequestCard({ job, onSave }) {
  const [review, setReview] = useState(undefined);
  const [holdNow, setHoldNow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('reviews').select('*').eq('job_id', job.id).maybeSingle();
    setReview(data || null);
    if (!data || data.status === 'scheduled') {
      const { data: hold } = await supabase.rpc('review_hold_reason', { p_job: job.id });
      setHoldNow(hold || null);
    } else {
      setHoldNow(null);
    }
  }, [job.id]);

  useEffect(() => { load(); }, [load]);

  async function sendEmail(token, remind = false) {
    const to = job.billing_email || job.customer_email || '';
    if (!to) throw new Error('Add a contact email on the Customer tab before sending.');
    const { subject, html, text } = buildReviewInviteEmail({ customerName: job.customer_name, reviewUrl: reviewUrl(token), projectLabel: job.job_type, reminder: remind });
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html, text, category: 'review_request', jobId: job.id, sentBy: session?.user?.email || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send.');
    return to;
  }

  async function sendNow() {
    setBusy(true); setResult('');
    let wasNew = !review || review.status !== 'sent';
    try {
      const { data: token, error } = await supabase.rpc('staff_send_review_now', { p_job: job.id });
      if (error) throw new Error(error.message);
      let to;
      try {
        to = await sendEmail(token);
      } catch (err) {
        // The email didn't go, so don't leave it marked as sent.
        if (wasNew) {
          const { data: row } = await supabase.from('reviews').select('id').eq('job_id', job.id).maybeSingle();
          if (row) await supabase.rpc('unclaim_review_send', { p_review: row.id });
        }
        throw err;
      }
      setResult(`Sent to ${to}.`);
      await load();
    } catch (err) {
      setResult(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    const why = window.prompt('Why skip the review request for this project? (saved with the project)', '');
    if (why === null) return;
    setBusy(true); setResult('');
    try {
      if (review && review.status !== 'submitted') {
        const { error } = await supabase.from('reviews').update({ status: 'skipped', skip_reason: (why || 'skipped by staff').trim() }).eq('id', review.id);
        if (error) throw new Error(error.message);
      }
      await onSave({ review_suppressed: true, review_suppressed_reason: (why || '').trim() || null });
      await load();
    } catch (err) { setResult(err.message); } finally { setBusy(false); }
  }

  async function unsuppress() {
    setBusy(true); setResult('');
    try {
      await onSave({ review_suppressed: false, review_suppressed_reason: null });
      if (review && review.status === 'skipped') {
        await supabase.from('reviews').update({ status: 'scheduled', skip_reason: null, hold_reason: null }).eq('id', review.id);
      }
      await load();
    } catch (err) { setResult(err.message); } finally { setBusy(false); }
  }

  async function remind() {
    if (!review) return;
    setBusy(true); setResult('');
    try {
      const to = await sendEmail(review.token, true);
      setResult(`Reminder sent to ${to}.`);
    } catch (err) { setResult(err.message); } finally { setBusy(false); }
  }

  if (review === undefined) return <div className="card"><h3>Customer Review</h3><div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</div></div>;

  const st = review ? REVIEW_STATUS[review.status] : null;
  const suppressed = !!job.review_suppressed;
  const legacySent = !review && job.review_requested_at;

  return (
    <div className="card">
      <h3>Customer Review</h3>

      {st && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4, color: st.color, background: st.bg }}>{st.label}</span>
          {review.status === 'scheduled' && review.send_after && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginLeft: 8 }}>due {fmt(review.send_after)}</span>}
          {review.status === 'sent' && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginLeft: 8 }}>sent {fmt(review.sent_at)}{review.reminder_sent_at ? `, reminder ${fmt(review.reminder_sent_at)}` : ''}</span>}
        </div>
      )}

      {review?.status === 'submitted' ? (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ color: '#c99a3a', fontSize: 20 }}>{starText(review.rating)}</div>
          {review.comment && <div style={{ margin: '6px 0', fontStyle: 'italic' }}>&ldquo;{review.comment}&rdquo;</div>}
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
            {review.reviewer_name || job.customer_name || 'Customer'} · {fmt(review.submitted_at)}
            {Object.keys(review.category_ratings || {}).length > 0 && ' · ' + Object.entries(review.category_ratings).map(([k, v]) => `${CATEGORY_LABELS[k] || k} ${v}/5`).join(', ')}
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, color: review.needs_follow_up && !review.follow_up_done_at ? '#a13f3f' : 'var(--ink-soft)' }}>
            {review.needs_follow_up && !review.follow_up_done_at ? 'Needs a follow-up call. ' : ''}
            {review.publish_consent ? (review.published ? 'Published on the website.' : 'Customer allows public use — not published yet.') : 'Not cleared for public use.'}
            {review.google_prompted ? (review.google_clicked_at ? ' Opened the Google link.' : ' Offered Google.') : ''}
          </div>
          <div style={{ marginTop: 8 }}><Link href="/reviews" style={{ fontSize: 12 }}>Manage reviews →</Link></div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12, lineHeight: 1.55 }}>
            {suppressed
              ? `Turned off for this project${job.review_suppressed_reason ? ` — ${job.review_suppressed_reason}` : ''}. No automatic request will go out.`
              : review?.status === 'skipped'
                ? `Not sent${review.skip_reason ? ` — ${holdLabel(review.skip_reason)}` : ''}.`
                : review?.status === 'sent'
                  ? 'Waiting for the customer to reply. Google is offered only after they rate the project here.'
                  : holdNow
                    ? `Waiting: ${holdLabel(holdNow)}. It goes out automatically once that clears.`
                    : review
                      ? 'Will go out automatically on the date above.'
                      : legacySent
                        ? `A Google review request was sent on ${fmt(job.review_requested_at)}. Sending now uses the private review form instead.`
                        : 'Every completed job gets a private review request a few days after completion.'}
          </div>
          <div className="section-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-primary btn-sm" onClick={sendNow} disabled={busy}>
              {busy ? 'Working…' : review?.status === 'sent' ? 'Resend' : 'Send now'}
            </button>
            {review?.status === 'sent' && <button className="btn btn-sm" onClick={remind} disabled={busy}>Send reminder</button>}
            {suppressed
              ? <button className="btn btn-sm" onClick={unsuppress} disabled={busy}>Turn back on</button>
              : <button className="btn btn-sm" onClick={skip} disabled={busy}>Don&rsquo;t ask this customer</button>}
          </div>
        </>
      )}

      {result && <div style={{ fontSize: 12, marginTop: 8, color: /^(Sent|Reminder)/.test(result) ? '#3a6b45' : '#a13f3f' }}>{result}</div>}
    </div>
  );
}
