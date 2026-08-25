'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SubPortalAuthLayout from '../../components/SubPortalAuthLayout';

export default function SubPortalLandingPage() {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  async function startApplication() {
    setApplying(true);
    setApplyError('');
    try {
      const res = await fetch('/api/public/subcontractor-application/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      router.push(`/subcontractor-apply/${data.token}`);
    } catch (err) {
      setApplyError(err.message);
      setApplying(false);
    }
  }

  return (
    <SubPortalAuthLayout>
      <div className="login-card sub-landing-card">
        <h1>Subcontractor Portal</h1>
        <p className="sub">McLoud Construction — tell us who you are to get to the right place.</p>

        <div className="sub-landing-options">
          <a href="/sub-portal/login?role=crew" className="sub-landing-option">
            <div className="sub-landing-option-title">Crew</div>
            <div className="sub-landing-option-desc">View your project details and work orders on site.</div>
          </a>
          <a href="/sub-portal/login?role=admin" className="sub-landing-option">
            <div className="sub-landing-option-title">Owner / Manager</div>
            <div className="sub-landing-option-desc">Accept and sign work orders, view invoices, and manage your team's logins.</div>
          </a>
          <button type="button" className="sub-landing-option" onClick={startApplication} disabled={applying}>
            <div className="sub-landing-option-title">New Subcontractor</div>
            <div className="sub-landing-option-desc">
              {applying ? 'Taking you to the application…' : "Don't have a login yet? Submit your company info to work with McLoud."}
            </div>
          </button>
        </div>
        {applyError && <div className="error-text">{applyError}</div>}
      </div>

      <style jsx global>{`
        .sub-landing-card{ max-width: 420px; box-shadow: none; border: 1px solid var(--panel-line); }
        .sub-landing-options{ display: flex; flex-direction: column; gap: 10px; }
        .sub-landing-option{
          display: block; width: 100%; text-align: left; padding: 14px 16px; border-radius: 8px;
          border: 1px solid var(--panel-line); background: var(--panel); cursor: pointer; text-decoration: none;
          font-family: inherit; transition: border-color 0.15s ease, transform 0.1s ease;
        }
        .sub-landing-option:hover{ border-color: var(--rust); transform: translateY(-1px); }
        .sub-landing-option:disabled{ opacity: 0.6; cursor: default; transform: none; }
        .sub-landing-option-title{ font-size: 14px; font-weight: 700; color: var(--heading); margin-bottom: 3px; }
        .sub-landing-option-desc{ font-size: 12px; color: var(--ink-soft); line-height: 1.5; }

        @media (min-width: 900px){
          .sub-landing-card{ max-width: 560px; padding: 48px 44px; }
          .sub-landing-card h1{ font-size: 24px; }
          .sub-landing-card p.sub{ font-size: 14px; margin-bottom: 28px; }
          .sub-landing-options{ gap: 14px; }
          .sub-landing-option{ padding: 20px 22px; }
          .sub-landing-option-title{ font-size: 16px; margin-bottom: 5px; }
          .sub-landing-option-desc{ font-size: 13px; }
        }
      `}</style>
    </SubPortalAuthLayout>
  );
}
