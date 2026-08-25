'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import SubPortalAuthLayout from '../../../components/SubPortalAuthLayout';

export default function SubPortalResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase exchanges the token in the URL for a temporary session and
    // fires PASSWORD_RECOVERY automatically — but if the page loads after
    // that already happened (e.g. a refresh), a plain session also counts.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasRecoverySession(true);
      }
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasRecoverySession(true);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password needs to be at least 6 characters.');
      return;
    }
    setSaving(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      setTimeout(() => router.replace('/sub-portal/dashboard'), 1600);
    }
  }

  if (!ready) return null;

  return (
    <SubPortalAuthLayout>
      <div className="login-card" style={{ boxShadow: 'none', border: '1px solid var(--panel-line)' }}>
        <h1>Reset Your Password</h1>

        {!hasRecoverySession ? (
          <p className="sub" style={{ color: '#a13f3f' }}>
            This reset link isn't valid or has expired. Request a new one from the sign-in page.
          </p>
        ) : done ? (
          <p className="sub" style={{ color: '#3a6b45' }}>
            Password updated! Taking you to your dashboard…
          </p>
        ) : (
          <>
            <p className="sub">Choose a new password for your subcontractor portal login.</p>
            <form onSubmit={submit}>
              <label htmlFor="newPassword">New password</label>
              <input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required autoFocus />
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                {saving ? 'Saving…' : 'Set New Password'}
              </button>
            </form>
          </>
        )}

        {!hasRecoverySession && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <a href="/sub-portal/login" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>← Back to sign in</a>
          </div>
        )}
      </div>
    </SubPortalAuthLayout>
  );
}
