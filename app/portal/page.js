'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If already signed in (e.g. clicked the magic link and landed here), go straight in.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/portal/dashboard');
    });
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/portal/dashboard` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Project Portal</h1>
        <p className="sub">McLoud Construction — enter your email and we'll send you a secure link to view your project.</p>

        {sent ? (
          <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
            Check your email for a login link — it may take a minute or two to arrive. You can close this tab.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
              {loading ? 'Sending…' : 'Email me a login link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
