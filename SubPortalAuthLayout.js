export default function SubPortalAuthLayout({ children }) {
  return (
    <div className="subportal-auth-wrap portal-textured">
      <div className="subportal-auth-brand">
        <img src="/mcloud-logo.png" alt="McLoud Construction" className="subportal-auth-logo" />
        <div>
          <h2>Subcontractor Portal</h2>
          <p>Review and sign work orders, track your invoices, and manage who on your team has access — all in one place.</p>
        </div>
        <div className="subportal-auth-brand-foot">McLoud Construction</div>
      </div>
      <div className="subportal-auth-content">
        <img src="/mcloud-logo.png" alt="McLoud Construction" className="subportal-auth-logo-mobile" />
        {children}
      </div>
    </div>
  );
}
