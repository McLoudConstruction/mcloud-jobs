'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

export default function PasswordPromptModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  async function setupPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setResult('Password needs to be at least 6 characters.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setResult(error.message);
    } else {
      setResult('Password set! You can now sign in with your email and password anytime.');
      setTimeout(onClose, 1800);
    }
  }

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Want to skip the email link next time?</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
          Set up a password and you can sign in with your email and password anytime — no need to wait on a new link.
        </p>
        <form onSubmit={setupPassword}>
          <label htmlFor="promptPassword">New password</label>
          <input id="promptPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required />
          {result && <div style={{ fontSize: 12.5, color: result.startsWith('Password set') ? '#3a6b45' : '#a13f3f', marginTop: 8 }}>{result}</div>}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Set up password'}</button>
            <button className="btn btn-sm" type="button" onClick={onClose}>Maybe later</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

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
};
