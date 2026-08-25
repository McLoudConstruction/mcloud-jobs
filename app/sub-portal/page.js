'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SubPortalLandingPage() {
  const router = useRouter();
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyEmail, setApplyEmail] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState('');

  async function submitApply(e) {
    e.preventDefault();
    setApplyLoading(true);
    setApplyError('');
    try {
      const res = await fetch('/api/public/subcontractor-application/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: applyEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      router.push(`/subcontractor-apply/${data.token}`);
    } catch (err) {
      setApplyError(err.message);
      setApplyLoading(false);
    }
  }

  return (
    <div className="login-wrap portal-textured">
      <div className="login-card sub-landing-card">
        <h1>Subcontractor Portal</h1>
        <p className="sub">McLoud Construction — tell us who you are to get to the right place.</p>

        {!applyOpen ? (
          <div className="sub-landing-options">
            <a href="/sub-portal/login?role=crew" className="sub-landing-option">
              <div className="sub-landing-option-title">Crew</div>
              <div className="sub-landing-option-desc">View your project details and work orders on site.</div>
            </a>
            <a href="/sub-portal/login?role=admin" className="sub-landing-option">
              <div className="sub-landing-option-title">Owner / Manager</div>
              <div className="sub-landing-option-desc">Accept and sign work orders, view invoices, and manage your team's logins.</div>
            </a>
            <button type="button" className="sub-landing-option" onClick={() => setApplyOpen(true)}>
              <div className="sub-landing-option-title">New Subcontractor</div>
              <div className="sub-landing-option-desc">Don't have a login yet? Submit your company info to work with McLoud.</div>
            </button>
          </div>
        ) : (
          <form onSubmit={submitApply}>
            <label htmlFor="apply-email">Your email</label>
            <input id="apply-email" type="email" value={applyEmail} onChange={e => setApplyEmail(e.target.value)} required autoFocus />
            {applyError && <div className="error-text">{applyError}</div>}
            <button className="btn btn-primary" type="submit" disabled={applyLoading} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
              {applyLoading ? 'Starting…' : 'Continue'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => { setApplyOpen(false); setApplyError(''); }} style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>
              ← Back
            </button>
          </form>
        )}
      </div>

      <style jsx global>{`
        .sub-landing-card{ max-width: 420px; }
        .sub-landing-options{ display: flex; flex-direction: column; gap: 10px; }
        .sub-landing-option{
          display: block; width: 100%; text-align: left; padding: 14px 16px; border-radius: 8px;
          border: 1px solid var(--panel-line); background: var(--panel); cursor: pointer; text-decoration: none;
          font-family: inherit;
        }
        .sub-landing-option:hover{ border-color: var(--rust); }
        .sub-landing-option-title{ font-size: 14px; font-weight: 700; color: var(--heading); margin-bottom: 3px; }
        .sub-landing-option-desc{ font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
      `}</style>
    </div>
  );
}
