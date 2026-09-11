'use client';
import { useSettings } from '../lib/useSettings';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

const LOGO_SRC = '/mcloud-logo.png';

// Pure presentational doc body, shared by the legacy /proposal page (the
// job's currently-Selected proposal) and /proposal/[proposalId] (any
// individual saved proposal). Both wrap this in their own toolbar,
// SendDocModal, and sent/viewed tracking — only the markup and print
// styling live here, so the two documents can never visually drift.
export default function ProposalDocument({ docTag, footerLabel, customerName, customerContact, projectAddress, description, price, scope, terms, materials }) {
  const { settings } = useSettings();
  const logoUrl = settings.logo_url || LOGO_SRC;
  const showContact = customerContact && customerContact.trim().toLowerCase() !== (customerName || '').trim().toLowerCase();
  return (
    <div className="doc-outer">
      <div className="doc-page" id="doc-preview">
        <div className="doc-header">
          <img src={logoUrl} alt="McLoud Construction" className="doc-logo" />
          <div className="doc-header-tagline">
            <span className="doc-tagline-l1">Built Right.</span>
            <span className="doc-tagline-l2">Told Straight.</span>
          </div>
          <div className="doc-brand-tag">Estimate<span className="doc-num">{docTag}</span></div>
        </div>

        <div className="doc-body">
          <h1 className="doc-title">Project Estimate</h1>

          <div className="party-grid">
            <div>
              <h4>Contractor</h4>
              <p>McLoud Construction</p>
            </div>
            <div>
              <h4>Customer</h4>
              <p>{customerName || 'Customer name'}</p>
              {showContact && <p className="dim">{customerContact}</p>}
            </div>
          </div>

          <div className="section">
            <h3>Project</h3>
            <p style={{ marginBottom: 4 }}><b>Jobsite:</b> {projectAddress || '—'}</p>
            <p style={{ marginBottom: 12 }}><b>Estimate date:</b> {fmtDate(new Date().toISOString().slice(0, 10))}</p>
            <p className={description ? '' : 'empty'}>{description || 'No description entered yet.'}</p>
          </div>

          <div className="price-box">
            <span className="price-label">Total Investment</span>
            <span className="price-amount">{fmtMoney(price)}</span>
          </div>

          <div className="section">
            <h3>Scope of work</h3>
            {(!scope || scope.length === 0) ? (
              <ul className="doc-list"><li className="empty">No scope items added yet.</li></ul>
            ) : (
              <ul className="doc-list">{scope.map((s, i) => <li key={i}>{s.text}</li>)}</ul>
            )}
          </div>

          {materials && materials.length > 0 && (
            <div className="section">
              <h3>Materials</h3>
              <div className="materials-grid">
                {materials.map((m, i) => (
                  <div className="material-tile" key={i}>
                    <img src={m.url} alt={m.description || 'Material'} />
                    <span>{m.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <h3>Assumptions &amp; exclusions</h3>
            <ul className="doc-list">{(terms || []).map((t, i) => <li key={i}>{t.text}</li>)}</ul>
          </div>

          <div className="doc-footer">
            <span>Stachys — McLoud Construction</span>
            <span>{footerLabel}</span>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@700;800&display=swap');
        body { background: #EDE7DA; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 1000px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px 22px; display: flex; align-items: center; gap: 16px; border-bottom: 4px solid #1C1B19; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-header-tagline { font-family: 'Big Shoulders', sans-serif; font-weight: 800; line-height: 0.92; text-transform: uppercase; letter-spacing: -0.01em; align-self: flex-end; }
        .doc-tagline-l1, .doc-tagline-l2 { display: block; font-size: 19px; }
        .doc-tagline-l1 { color: #1C1B19; }
        .doc-tagline-l2 { color: #9B773D; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9B773D; text-align: right; }
        .doc-num { display: block; font-weight: 500; font-size: 10.5px; letter-spacing: 0.05em; color: #6b6350; text-transform: none; margin-top: 3px; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9B773D; margin: 0 0 18px; }
        .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-bottom: 20px; margin-bottom: 10px; border-bottom: 1px solid #ded7c0; break-inside: avoid; }
        .party-grid h4 { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #9B773D; margin: 0 0 6px; }
        .party-grid p { font-size: 12.5px; line-height: 1.55; color: #1C1B19; margin: 0; }
        .party-grid p.dim { color: #6b6350; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 34px; border-bottom: 1px solid #ded7c0; }
        .section { margin-bottom: 24px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9B773D; margin: 0 0 10px; padding-left: 11px; border-left: 3px solid #9B773D; break-after: avoid; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #1C1B19; margin: 0; }
        .section p.empty { color: #a8a29a; font-style: italic; }
        .doc-list { margin: 0; padding-left: 0; list-style: none; }
        .doc-list li { font-size: 13.5px; line-height: 1.6; color: #1C1B19; padding-left: 20px; position: relative; margin-bottom: 7px; break-inside: avoid; }
        .doc-list li::before { content: "—"; position: absolute; left: 0; color: #9B773D; }
        .materials-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; break-inside: avoid; }
        .material-tile { display: flex; flex-direction: column; gap: 5px; break-inside: avoid; }
        .material-tile img { width: 100%; height: 90px; object-fit: cover; border-radius: 5px; border: 1px solid #ded7c0; }
        .material-tile span { font-size: 10.5px; color: #6b6350; line-height: 1.35; }
        .doc-list li.empty { color: #a8a29a; font-style: italic; }
        .doc-list li.empty::before { content: ""; }
        .price-box { background: #faf6ec; border: 1px solid #ded7c0; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
        .proposal-cta {
          display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
          background: #A8471F; color: #fff; text-decoration: none;
          border-radius: 8px; padding: 18px 22px; margin-bottom: 28px;
        }
        .proposal-cta:hover { background: #7C3316; }
        .proposal-cta-text { font-size: 14px; font-weight: 500; opacity: 0.9; }
        .proposal-cta-action { font-size: 16px; font-weight: 700; }
        @media (max-width: 500px) { .proposal-cta { flex-direction: column; align-items: flex-start; } }

        .price-label { font-weight: 700; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #9B773D; }
        .price-amount { font-weight: 700; font-size: 19px; color: #1C1B19; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }

        @media (max-width: 700px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; flex-wrap: wrap; }
          .doc-tagline-l1, .doc-tagline-l2 { font-size: 14px; }
          .doc-body { padding: 20px 20px 40px; }
          .party-grid { grid-template-columns: 1fr; }
          .doc-logo { width: 130px; }
        }

        @media print {
          .continued-note { display: block; }
          .no-print { display: none !important; }
          body { background: #fff; }
          .doc-outer { padding: 0; }
          .doc-page { box-shadow: none; max-width: none; }
        }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
