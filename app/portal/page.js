'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function PortalLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('link'); // 'link' | 'password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If already signed in (e.g. clicked the magic link and landed here), go straight in.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/portal/dashboard');
    });
  }, [router]);

  async function handleLinkSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    // Not supabase.auth.signInWithOtp() — see app/api/portal/magic-link's
    // comment: that sends through Supabase Auth's own rate-limited
    // built-in mailer, can silently drop sends, and never logs to
    // Communications Log. This is the legacy pre-/customerportal login
    // page; portalType: 'customer' lands the link on /customerportal/projects
    // rather than this page's own /portal/dashboard — the same customer
    // account, just forwarded onto the current portal instead of the one
    // this page belongs to.
    try {
      const res = await fetch('/api/portal/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, portalType: 'customer' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send sign-in link.');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError('Incorrect email or password, or a password hasn\'t been set up yet on this account.');
    else router.replace('/portal/dashboard');
  }

  return (
    <div className="login-wrap portal-textured">
      <div className="login-card">
        <h1>Project Portal</h1>
        <p className="sub">McLoud Construction — view your project updates, invoice, and questions.</p>

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
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
                  Haven't set a password yet? Use "Email me a link" once, then set one up from inside the portal.
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
