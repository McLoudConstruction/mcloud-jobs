export default function SubcontractorApplyChrome({ children }) {
  return (
    <div className="mcw-page">
      <header className="mcw-header">
        <img src="/mcloud-logo.png" alt="McLoud Construction" className="mcw-logo" />
        <a href="https://mcloudconstruction.com" className="mcw-header-link">mcloudconstruction.com ↗</a>
      </header>
      {children}
      <footer className="mcw-footer">
        <img src="/mcloud-logo.png" alt="McLoud Construction" className="mcw-footer-logo" />
        <div className="mcw-footer-meta">
          <span>© {new Date().getFullYear()} McLoud Contracting, LLC</span>
          <span className="mcw-footer-dot">·</span>
          <span>Greater Kansas City Metro</span>
        </div>
      </footer>
      <style jsx global>{`
        .mcw-page{
          --mcw-ink: #1C1B19; --mcw-paper: #EDE7DA; --mcw-brass: #9B773D;
          --mcw-blueprint: #2F4858; --mcw-rust: #A8471F; --mcw-concrete: #8B8578;
          --mcw-display: 'Big Shoulders', sans-serif; --mcw-body: 'Work Sans', sans-serif; --mcw-mono: 'IBM Plex Mono', monospace;
          background: var(--mcw-paper); color: var(--mcw-ink); font-family: var(--mcw-body);
          min-height: 100vh; display: flex; flex-direction: column;
        }
        .mcw-header{
          background: var(--mcw-ink); color: var(--mcw-paper); display: flex; align-items: center;
          justify-content: space-between; padding: 14px 24px; position: sticky; top: 0; z-index: 10;
        }
        .mcw-logo{ height: 36px; width: auto; }
        .mcw-header-link{
          font-family: var(--mcw-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em;
          color: rgba(237,231,218,0.65); text-decoration: none;
        }
        .mcw-header-link:hover{ color: var(--mcw-brass); }

        .mcw-hero{ background: var(--mcw-ink); color: var(--mcw-paper); padding: 56px 24px 64px; }
        .mcw-hero-inner{ max-width: 720px; margin: 0 auto; }
        .mcw-eyebrow{
          display: inline-flex; align-items: center; gap: 0.4em; border: 1.5px solid var(--mcw-brass);
          border-radius: 9999px; padding: 0.35em 0.9em; font-family: var(--mcw-mono); font-size: 11px;
          letter-spacing: 0.12em; text-transform: uppercase; color: var(--mcw-brass); transform: rotate(-1.5deg);
        }
        .mcw-hero h1{
          font-family: var(--mcw-display); font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em;
          line-height: 0.95; font-size: 44px; margin: 22px 0 0;
        }
        .mcw-hero p{ font-family: var(--mcw-body); font-size: 15.5px; line-height: 1.7; color: rgba(237,231,218,0.8); margin: 18px 0 0; max-width: 560px; }

        .mcw-form-wrap{ flex: 1; max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; width: 100%; }
        .mcw-section-label{
          font-family: var(--mcw-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em;
          color: var(--mcw-concrete); margin: 32px 0 4px;
        }
        .mcw-section-label:first-child{ margin-top: 0; }
        .mcw-tick-rule{ position: relative; height: 1px; background: var(--mcw-concrete); opacity: 0.4; margin: 32px 0 0; }
        .mcw-tick-rule::before, .mcw-tick-rule::after{ content: ''; position: absolute; top: -4px; width: 1px; height: 9px; background: var(--mcw-concrete); }
        .mcw-tick-rule::before{ left: 0; } .mcw-tick-rule::after{ right: 0; }

        .mcw-page form{ font-family: var(--mcw-body); }
        .mcw-page label{
          display: block; font-family: var(--mcw-mono); font-size: 11px; text-transform: uppercase;
          letter-spacing: 0.14em; color: var(--mcw-concrete); margin: 20px 0 6px;
        }
        .mcw-page label:first-of-type{ margin-top: 0; }
        .mcw-page input[type="text"], .mcw-page input[type="email"], .mcw-page input[type="tel"],
        .mcw-page input[type="date"], .mcw-page input:not([type]), .mcw-page textarea{
          width: 100%; border: none; border-bottom: 1.5px solid rgba(28,27,25,0.25); background: transparent;
          padding: 10px 2px; font-family: var(--mcw-body); font-size: 14.5px; color: var(--mcw-ink); border-radius: 0;
        }
        .mcw-page input::placeholder, .mcw-page textarea::placeholder{ color: rgba(28,27,25,0.32); }
        .mcw-page input:focus, .mcw-page textarea:focus{ outline: none; border-color: var(--mcw-brass); }
        .mcw-page textarea{ min-height: 90px; line-height: 1.6; resize: vertical; }
        .mcw-page input[type="file"]{
          width: 100%; font-family: var(--mcw-body); font-size: 13px; color: var(--mcw-ink);
          border: 1.5px dashed rgba(28,27,25,0.25); padding: 12px; background: rgba(237,231,218,0.4);
        }
        .mcw-photo-grid{ display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-top: 12px; }
        .mcw-photo-thumb{ position: relative; border: 1px solid rgba(28,27,25,0.15); }
        .mcw-photo-thumb img{ width: 100%; height: 84px; object-fit: cover; display: block; }
        .mcw-photo-thumb button{
          position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: none;
          background: rgba(28,27,25,0.7); color: var(--mcw-paper); font-size: 14px; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }

        .mcw-two-col{ display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
        @media (max-width: 560px){ .mcw-two-col{ grid-template-columns: 1fr; } }
        .mcw-two-col > div > label{ margin-top: 0; }

        .mcw-checkbox-grid{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 14px; margin-top: 10px; }
        .mcw-page .mcw-checkbox{ display: flex; align-items: center; gap: 8px; font-family: var(--mcw-body); font-size: 13.5px; color: var(--mcw-ink); cursor: pointer; margin: 0; text-transform: none; letter-spacing: normal; }
        .mcw-checkbox input[type="checkbox"]{ width: 16px; height: 16px; accent-color: var(--mcw-brass); cursor: pointer; }

        .mcw-error{ font-family: var(--mcw-body); font-size: 13px; color: var(--mcw-rust); margin-top: 14px; }
        .mcw-submit{
          margin-top: 36px; width: 100%; background: var(--mcw-brass); color: var(--mcw-ink); border: none;
          padding: 16px 28px; font-family: var(--mcw-mono); font-size: 12px; text-transform: uppercase;
          letter-spacing: 0.15em; cursor: pointer; transition: opacity 0.15s ease; border-radius: 0;
        }
        .mcw-submit:hover{ opacity: 0.88; }
        .mcw-submit:disabled{ opacity: 0.55; cursor: default; }

        .mcw-status-card{ max-width: 560px; margin: 0 auto; padding: 60px 24px 100px; text-align: center; }
        .mcw-status-card .mcw-eyebrow{ margin-bottom: 20px; }
        .mcw-status-card h1{
          font-family: var(--mcw-display); font-weight: 800; text-transform: uppercase; font-size: 32px;
          color: var(--mcw-ink); margin: 0 0 14px;
        }
        .mcw-status-card p{ font-family: var(--mcw-body); font-size: 15px; line-height: 1.7; color: rgba(28,27,25,0.72); }

        .mcw-footer{
          background: var(--mcw-ink); color: var(--mcw-paper); padding: 28px 24px; margin-top: auto;
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;
        }
        .mcw-footer-logo{ height: 26px; width: auto; opacity: 0.9; }
        .mcw-footer-meta{ font-family: var(--mcw-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: rgba(237,231,218,0.45); display: flex; gap: 8px; align-items: center; }
        .mcw-footer-dot{ opacity: 0.5; }
      `}</style>
    </div>
  );
}
