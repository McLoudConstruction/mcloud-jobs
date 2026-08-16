'use client';
import { useState } from 'react';

export default function SendDocModal({ open, onClose, docLabel, defaultEmail, subject, bodyHtml, bodyText, onPrint }) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  if (!open) return null;

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, html: bodyHtml, text: bodyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setResult({ ok: true, message: `Sent to ${email}.` });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{docLabel}</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
          Download a copy for yourself, or send it straight to the customer by email.
        </p>

        <label>Customer email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />

        {result && (
          <div style={{ fontSize: 12.5, marginTop: 10, color: result.ok ? '#3a6b45' : '#a13f3f' }}>
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onPrint}>↓ Download / Print PDF</button>
          <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !email.trim()}>
            {sending ? 'Sending…' : '✉ Send to Customer'}
          </button>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 14 }}>
          The email sends the document as a formatted message rather than a PDF file attachment — "Download / Print PDF" is the way to get an actual PDF file.
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
};
const modalStyle = {
  background: '#fff', borderRadius: 8, padding: 26, width: '100%', maxWidth: 420,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
};
