'use client';
import { Suspense, useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRouter, useSearchParams } from 'next/navigation';

const ROLE_COPY = {
  crew: "Signing in as crew — you'll be able to view your project details and work orders.",
  admin: "Signing in as Owner/Manager — you'll be able to accept and sign work orders, and manage your team's logins.",
};

function SubPortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleHint = searchParams.get('role');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/sub-portal/dashboard');
    });
  }, [router]);

  async function handleSubmit(e) {
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

  return (
    <div className="login-wrap portal-textured">
      <div className="login-card">
        <h1>Subcontractor Portal</h1>
        <p className="sub">
          {ROLE_COPY[roleHint] || 'McLoud Construction — view and sign your work orders.'}
        </p>

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

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <a href="/sub-portal" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>← Back</a>
        </div>
      </div>
    </div>
  );
}

export default function SubPortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <SubPortalLoginForm />
    </Suspense>
  );
}
