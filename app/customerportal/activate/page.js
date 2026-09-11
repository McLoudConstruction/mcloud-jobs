'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { SUPPORT_EMAIL } from '../../../lib/constants';

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivatePageInner />
    </Suspense>
  );
}

function ActivatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [checking, setChecking] = useState(true);
  const [validation, setValidation] = useState(null); // { valid, email, reason }
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setValidation({ valid: false, reason: 'missing' });
      setChecking(false);
      return;
    }
    fetch(`/api/portal/activate?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => setValidation(data))
      .catch(() => setValidation({ valid: false, reason: 'error' }))
      .finally(() => setChecking(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password needs to be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/portal/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set up your account.');

      // Sign in with the password we just set so the customer lands
      // straight in the portal instead of having to log in again.
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: data.email, password });
      if (signInError) {
        // The account was created successfully even if this immediate
        // sign-in hiccups — send them to the regular sign-in page instead
        // of showing an error for something that isn't really a failure.
        router.replace('/customerportal');
        return;
      }
      // They just set a password as part of activation — skip the
      // separate "want to set a password?" nudge on their first visit.
      if (signInData?.session?.user?.id) {
        window.localStorage.setItem(`mcloud-portal-password-prompt-dismissed-${signInData.session.user.id}`, '1');
      }
      router.replace('/customerportal/projects');
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (checking) return <div className="login-wrap portal-textured"><div className="login-card"><p className="sub">Checking your invite…</p></div></div>;

  if (!validation?.valid) {
    const isAlreadyActivated = validation?.reason === 'already_activated';
    return (
      <div className="login-wrap portal-textured">
        <div className="login-card">
          <h1>Project Portal</h1>
          {isAlreadyActivated ? (
            <>
              <p className="sub">This account is already set up.</p>
              <a href="/customerportal" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>Go to Sign In</a>
            </>
          ) : (
            <>
              <p className="sub">
                {validation?.reason === 'expired'
                  ? "This invite link has expired. Reach out and we'll send a new one."
                  : "We couldn't find that invite link. Reach out and we'll get you sorted."}
              </p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>Email Us</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap portal-textured">
      <div className="login-card">
        <h1>Set Up Your Portal</h1>
        <p className="sub">Create a password for {validation.email} to finish setting up your McLoud Construction project portal.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="activateEmail">Email</label>
          <input id="activateEmail" type="email" value={validation.email} disabled />
          <label htmlFor="activatePassword" style={{ marginTop: 10 }}>Password</label>
          <input id="activatePassword" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required autoFocus />
          <label htmlFor="activateConfirm" style={{ marginTop: 10 }}>Confirm password</label>
          <input id="activateConfirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={6} required />
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
            {submitting ? 'Setting up…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
