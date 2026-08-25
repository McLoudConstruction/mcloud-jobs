'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { generatePdfBase64 } from '../lib/generatePdf';
import { buildDocEmail } from '../lib/emailTemplates';
import { supabase } from '../lib/supabaseClient';

export default function SendDocModal({ open, onClose, docLabel, docType, customerName, docElementId, pdfFilename, defaultEmail, jobId, onPrint, onSendSuccess }) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [notifyList, setNotifyList] = useState([]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!jobId || !open) return;
    supabase.from('job_portal_access').select('email').eq('job_id', jobId).eq('notify', true).then(({ data }) => {
      if (data) setNotifyList(data.map(r => r.email).filter(e => e && e !== defaultEmail));
    });
  }, [jobId, open, defaultEmail]);

  // Lock background scroll while the modal is open, so the page can't
  // scroll independently underneath a fixed-position overlay on mobile.
  useEffect(() => {
    if (open) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prevOverflow; };
    }
  }, [open]);

  if (!open || !mounted) return null;

  async function send(withAttachment) {
    setSending(true);
    setResult(null);
    try {
      let attachmentBase64 = null;
      if (withAttachment) {
        setResult({ ok: true, message: 'Generating PDF…' });
        attachmentBase64 = await generatePdfBase64(docElementId, pdfFilename);
      }

      setResult({ ok: true, message: 'Sending…' });
      const { subject, html, text } = buildDocEmail({ customerName, docType });
      const recipients = [email, ...notifyList].filter(Boolean).join(', ');

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients, subject, html, text,
          ...(withAttachment ? { attachmentBase64, attachmentFilename: pdfFilename } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      const recipientCount = 1 + notifyList.length;
      const recipientNote = recipientCount > 1 ? ` and ${notifyList.length} other contact${notifyList.length === 1 ? '' : 's'} on the notification list` : '';
      setResult({ ok: true, message: withAttachment ? `Sent to ${email}${recipientNote}, with the PDF attached.` : `Sent to ${email}${recipientNote} — they'll find it waiting in the Customer Portal.` });
      if (onSendSuccess) onSendSuccess();
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="send-doc-overlay" style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" style={closeButtonStyle}>×</button>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Send to Customer</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 18px' }}>
          Choose how to send {docLabel} to the customer.
        </p>

        <label>Customer email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />

        {result && (
          <div style={{ fontSize: 12.5, marginTop: 10, color: result.ok ? '#3a6b45' : '#a13f3f' }}>
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={sending || !email.trim()}>
            {sending ? 'Working…' : 'Send to Customer Portal (email notification only)'}
          </button>
          <button className="btn btn-sm" onClick={() => send(true)} disabled={sending || !email.trim()}>
            {sending ? 'Working…' : 'Email with PDF Attached'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const closeButtonStyle = {
  position: 'absolute', top: 10, right: 14,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 26, lineHeight: 1, color: 'var(--ink-soft)', padding: 4,
};

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 420,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto',
  position: 'relative',
};
