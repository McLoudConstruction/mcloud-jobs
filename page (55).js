'use client';
import { Suspense, useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRouter, useSearchParams } from 'next/navigation';
import SubPortalAuthLayout from '../../../components/SubPortalAuthLayout';

const ROLE_COPY = {
  crew: "Signing in as crew — you'll be able to view your project details and work orders.",
  admin: "Signing in as Owner/Manager — you'll be able to accept and sign work orders, and manage your team's logins.",
};

function SubPortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleHint = searchParams.get('role');
  const [mode, setMode] = useState('link'); // 'link' | 'password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/sub-portal/dashboard');
    });
  }, [router]);

  async function handleLinkSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/sub-portal/dashboard` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Incorrect email or password, or a password hasn't been set up yet on this account.");
    else router.replace('/sub-portal/dashboard');
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/sub-portal/reset-password`,
    });
    setForgotLoading(false);
    if (error) setForgotError(error.message);
    else setForgotSent(true);
  }

  return (
    <div className="login-card" style={{ boxShadow: 'none', border: '1px solid var(--panel-line)' }}>
      <h1>Subcontractor Portal</h1>
      <p className="sub">
        {ROLE_COPY[roleHint] || 'McLoud Construction — view and sign your work orders.'}
      </p>

      {sent ? (
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
          Check your email for a login link — it may take a minute or two to arrive. You can close this tab.
        </p>
      ) : (
        <>
          <div className="portal-mode-tabs">
            <button type="button" className={mode === 'link' ? 'active' : ''} onClick={() => { setMode('link'); setError(''); }}>Email me a link</button>
            <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); setError(''); }}>Sign in with password</button>
          </div>

          {mode === 'link' ? (
            <form onSubmit={handleLinkSubmit}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                {loading ? 'Sending…' : 'Email me a login link'}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit}>
              <label htmlFor="pwEmail">Email</label>
              <input id="pwEmail" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5 }}>
                <span style={{ color: 'var(--ink-soft)' }}>Haven't set a password yet? Use "Email me a link" once, then set one up from inside the portal.</span>
              </div>
              <button
                type="button"
                onClick={() => { setForgotOpen(o => !o); setForgotSent(false); setForgotError(''); }}
                style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, fontSize: 11.5, color: 'var(--rust)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Forgot your password?
              </button>

              {forgotOpen && (
                <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  {forgotSent ? (
                    <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: 0 }}>
                      If an account exists for {email || 'that email'}, a reset link is on its way. Check your inbox.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 8px' }}>
                        We'll send a reset link to the email above{!email && ' — fill it in first'}.
                      </p>
                      {forgotError && <div className="error-text" style={{ marginTop: 0, marginBottom: 8 }}>{forgotError}</div>}
                      <button type="button" className="btn btn-sm" onClick={handleForgotSubmit} disabled={forgotLoading || !email}>
                        {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </form>
          )}
        </>
      )}

      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <a href="/sub-portal" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>← Back</a>
      </div>
    </div>
  );
}

export default function SubPortalLoginPage() {
  return (
    <SubPortalAuthLayout>
      <Suspense fallback={null}>
        <SubPortalLoginForm />
      </Suspense>
    </SubPortalAuthLayout>
  );
}
