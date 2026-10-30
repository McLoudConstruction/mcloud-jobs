'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useStaffAuth } from '../lib/staffAuthContext';
import { ROLE_LABELS } from '../lib/permissions';
import { initialsFor, displayNameFor } from '../lib/userDisplay';

// The signed-in person's own account: name, login email, role, password.
// Shown on /settings/account (open to every staff role) and as the Account
// tab inside Settings (Owner).
export default function AccountPanel() {
  const router = useRouter();
  const { session, role, fullName, email, refresh } = useStaffAuth();

  const [name, setName] = useState(null); // null = not editing
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  const shownName = displayNameFor(fullName, email);
  const hasRealName = !!fullName && !fullName.includes('@');
  const editing = name !== null;

  async function saveName() {
    setNameErr('');
    setNameMsg('');
    if (!name.trim()) { setNameErr('Enter your name.'); return; }
    setSavingName(true);
    try {
      const res = await fetch('/api/staff/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ fullName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your name.');
      await refresh();
      setName(null);
      setNameMsg('Name saved.');
      setTimeout(() => setNameMsg(''), 3000);
    } catch (err) {
      setNameErr(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    setPwErr('');
    setPwMsg('');
    if (pw.length < 6) { setPwErr('Password needs to be at least 6 characters.'); return; }
    if (pw !== pw2) { setPwErr('The two passwords do not match.'); return; }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw('');
      setPw2('');
      setPwMsg('Password changed.');
      setTimeout(() => setPwMsg(''), 4000);
    } catch (err) {
      setPwErr(err.message || 'Could not change your password.');
    } finally {
      setSavingPw(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <>
      <div className="card">
        <div className="account-hero">
          <div className="account-avatar" aria-hidden="true">{initialsFor(fullName, email) || '?'}</div>
          <div>
            <div className="account-hero-name">{shownName || 'Your account'}</div>
            <div className="account-hero-sub">{[role && (ROLE_LABELS[role] || role), email].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Profile</h3>
        <div className="form-group">
          <label>Name</label>
          {editing ? (
            <>
              <input
                type="text"
                value={name}
                autoFocus
                placeholder="First and last name"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setName(null); }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={saveName} disabled={savingName}>{savingName ? 'Saving…' : 'Save name'}</button>
                <button className="btn" onClick={() => { setName(null); setNameErr(''); }} disabled={savingName}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{hasRealName ? fullName : <em style={{ color: 'var(--ink-soft)' }}>Not set. Your initials come from your email until you add a name.</em>}</span>
              <button className="btn btn-sm" onClick={() => { setName(hasRealName ? fullName : ''); setNameMsg(''); }}>{hasRealName ? 'Edit' : 'Add name'}</button>
              {nameMsg && <span className="saved-flash">{nameMsg}</span>}
            </div>
          )}
          {nameErr && <div className="error-text" style={{ marginTop: 8 }}>{nameErr}</div>}
        </div>
        <div className="form-group">
          <label>Email (your login)</label>
          <div>{email || ''}</div>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Role</label>
          <div>{role ? (ROLE_LABELS[role] || role) : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>Your role, email signature and access are managed by an Owner in Settings, Users.</div>
        </div>
      </div>

      <div className="card">
        <h3>Change password</h3>
        <div className="form-group">
          <label>New password</label>
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Confirm new password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={e => setPw2(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') savePassword(); }}
          />
        </div>
        {pwErr && <div className="error-text" style={{ marginBottom: 10 }}>{pwErr}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-primary" onClick={savePassword} disabled={savingPw || !pw}>{savingPw ? 'Saving…' : 'Change password'}</button>
          {pwMsg && <span className="saved-flash">{pwMsg}</span>}
        </div>
      </div>

      <div className="card">
        <h3>Session</h3>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </>
  );
}
