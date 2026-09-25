'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

// Staff-only "get a link I can text or email" button. Creates (or reuses)
// a no-login share link for one proposal or one photo folder, then shows a
// small sheet with the actions that matter on a phone: the native share
// sheet (Messages, WhatsApp, Mail…), a pre-filled text message, or copy.
// The sheet is a second tap on purpose — phones only allow the share sheet
// to open straight from a tap, not after a network request finishes.
//
// Props: kind ('proposal' | 'photo_folder'), jobId, proposalId?, folder?,
// customerName?, projectAddress?, label?, className?
export default function ShareLinkButton({ kind, jobId, proposalId, folder, customerName, projectAddress, label, className = 'btn btn-sm' }) {
  const [isStaff, setIsStaff] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState(null); // { url, expiresAt }
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    supabase.auth.getSession().then(({ data }) => setIsStaff(data.session?.user?.app_metadata?.role === 'admin'));
  }, []);

  // A different folder/proposal is a different link.
  useEffect(() => { setLink(null); setError(''); }, [kind, jobId, proposalId, folder]);

  if (!isStaff) return null;

  async function call(extra = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/share-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ kind, jobId, proposalId: proposalId || null, folder: folder || null, ...extra }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Something went wrong.');
    return body;
  }

  async function openSheet() {
    setOpen(true);
    setError('');
    setCopied(false);
    if (link) return;
    setBusy(true);
    try { setLink(await call()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function renew() {
    setBusy(true); setError(''); setCopied(false);
    try { setLink(await call({ renew: true })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function turnOff() {
    if (!confirm('Turn this link off? Anyone who has it will no longer be able to open it.')) return;
    setBusy(true); setError('');
    try { await call({ revoke: true }); setLink(null); setOpen(false); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const firstName = (customerName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}, ` : '';
  const message = kind === 'proposal'
    ? `${greeting}here's your estimate from McLoud Construction:`
    : `${greeting}here are the latest photos${folder ? ` (${folder})` : ''}${projectAddress ? ` from your project at ${projectAddress}` : ''}:`;
  const title = kind === 'proposal' ? 'Your estimate from McLoud Construction' : 'Project photos from McLoud Construction';

  async function nativeShare() {
    try { await navigator.share({ title, text: message, url: link.url }); } catch { /* cancelled */ }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${message} ${link.url}`);
      setCopied(true);
    } catch {
      window.prompt('Copy this link:', link.url);
    }
  }
  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const smsHref = link ? `sms:${isIos ? '&' : '?'}body=${encodeURIComponent(`${message} ${link.url}`)}` : '#';
  const emailHref = link ? `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${message}\n\n${link.url}`)}` : '#';
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const expires = link?.expiresAt ? new Date(link.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  const sheet = open && mounted ? createPortal(
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--panel, #fff)', color: 'var(--ink, #1C1B19)', width: '100%', maxWidth: 460, borderRadius: '14px 14px 0 0', padding: '18px 18px calc(18px + env(safe-area-inset-bottom))', boxShadow: '0 -6px 30px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: 'var(--heading)' }}>{kind === 'proposal' ? 'Share estimate link' : `Share “${folder}”`}</h3>
          <button className="btn btn-sm" type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
          {kind === 'proposal'
            ? 'No login needed — they can view and download the estimate.'
            : 'No login needed — always shows what is currently in this folder.'}
        </p>

        {busy && <div style={{ fontSize: 13 }}>Working…</div>}
        {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}

        {link && !busy && (
          <>
            <input readOnly value={link.url} onFocus={e => e.target.select()} style={{ width: '100%', fontSize: 12.5, marginBottom: 12 }} />
            <div style={{ display: 'grid', gap: 8 }}>
              {canNativeShare && <button className="btn btn-primary" type="button" onClick={nativeShare}>Share…</button>}
              <a className={canNativeShare ? 'btn' : 'btn btn-primary'} href={smsHref} style={{ textAlign: 'center' }}>Text message</a>
              <a className="btn" href={emailHref} style={{ textAlign: 'center' }}>Email</a>
              <button className="btn" type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>Expires {expires}</span>
              <span>
                <button type="button" onClick={renew} style={linkBtn}>New 30 days</button>
                {' · '}
                <button type="button" onClick={turnOff} style={{ ...linkBtn, color: '#a13f3f' }}>Turn off</button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button className={className} type="button" onClick={openSheet}>{label || 'Share Link'}</button>
      {sheet}
    </>
  );
}

const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-soft)', textDecoration: 'underline', fontSize: 11.5, fontFamily: 'inherit' };
