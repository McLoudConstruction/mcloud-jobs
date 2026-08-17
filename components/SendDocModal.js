'use client';
import { useState } from 'react';
import { generatePdfBase64 } from '../lib/generatePdf';
import { buildDocEmail } from '../lib/emailTemplates';

export default function SendDocModal({ open, onClose, docLabel, docType, customerName, docElementId, pdfFilename, defaultEmail, onPrint }) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  if (!open) return null;

  async function send() {
    setSending(true);
    setResult(null);
    try {
      setResult({ ok: true, message: 'Generating PDF…' });
      const attachmentBase64 = await generatePdfBase64(docElementId, pdfFilename);

      setResult({ ok: true, message: 'Sending…' });
      const { subject, html, text } = buildDocEmail({ customerName, docType });

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, html, text, attachmentBase64, attachmentFilename: pdfFilename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setResult({ ok: true, message: `Sent to ${email}, with the PDF attached.` });
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
          Download a copy for yourself, or email it straight to the customer with the PDF attached.
        </p>

        <label>Customer email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />

        {result && (
          <div style={{ fontSize: 12.5, marginTop: 10, color: result.ok ? '#3a6b45' : '#a13f3f' }}>
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onPrint}>Download / Print PDF</button>
          <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !email.trim()}>
            {sending ? 'Working…' : 'Send to Customer'}
          </button>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
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
