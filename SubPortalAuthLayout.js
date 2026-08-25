'use client';
import { useSettings } from '../lib/useSettings';

export default function SubPortalAuthLayout({ children }) {
  const { settings } = useSettings();
  const logoUrl = settings.logo_url || '/mcloud-logo.png';
  const logoSize = settings.logo_size_desktop || 180;
  const logoSizeMobile = settings.logo_size_mobile || 150;

  return (
    <div className="subportal-auth-wrap portal-textured">
      <div className="subportal-auth-brand">
        <img src={logoUrl} alt="McLoud Construction" className="subportal-auth-logo" style={{ height: logoSize, width: 'auto' }} />
        <div>
          <h2>Subcontractor Portal</h2>
          <p>Review and sign work orders, track your invoices, and manage who on your team has access — all in one place.</p>
        </div>
        <div className="subportal-auth-brand-foot">McLoud Construction</div>
      </div>
      <div className="subportal-auth-content">
        <img src={logoUrl} alt="McLoud Construction" className="subportal-auth-logo-mobile" style={{ height: logoSizeMobile, width: 'auto' }} />
        {children}
      </div>
    </div>
  );
}
