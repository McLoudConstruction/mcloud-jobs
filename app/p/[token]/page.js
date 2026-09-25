'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ProposalDocument from '../../../components/ProposalDocument';
import { generatePdfBase64, downloadPdf } from '../../../lib/generatePdf';
import { projectNumber } from '../../../lib/constants';
import { docFilename } from '../../../lib/docFilename';

const STANDARD_EXCLUSIONS = [
  'A deposit of 50% of the total project investment is due up front before work begins, with the remaining balance due per the agreed payment schedule.',
  'Estimate valid for 30 days from the date above.',
  'Pricing is based on visible conditions at the time of estimate. Concealed conditions discovered once work begins (moisture, structural, electrical, etc.) may require a change order.',
  'Permit fees, if required, are not included and will be billed separately.',
  'Homeowner is responsible for clearing the work area and relocating pets prior to each scheduled work day.',
  'Material selections not specified in the scope of work are estimated using a standard allowance and may affect final pricing.',
];

function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function OptionCard({ o }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 6, border: '1px solid #ded7c0', background: '#fdfcf8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1C1B19' }}>{o.label}</span>
        <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19', whiteSpace: 'nowrap' }}>{money(o.price)}</span>
      </div>
      {o.description && <div style={{ fontSize: 11.5, color: '#6b6350', marginTop: 4 }}>{o.description}</div>}
      {(o.scope_items || []).length > 0 && (
        <ul className="doc-list" style={{ marginTop: 8 }}>
          {o.scope_items.map((it, i) => <li key={i}>{it.text}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function PublicProposalPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`/api/public/share/${token}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'This link is not valid.');
        if (body.kind !== 'proposal') throw new Error('This link is not valid.');
        setData(body);
      })
      .catch(err => setError(err.message));
  }, [token]);

  async function download() {
    setDownloading(true);
    try {
      const filename = docFilename(
        data.proposalName ? `Estimate-${data.proposalName}` : 'Estimate',
        data.job.customer_name
      );
      const base64 = await generatePdfBase64('doc-preview', filename);
      downloadPdf(base64, filename);
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (error) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-soft)', maxWidth: 480, margin: '0 auto' }}>{error}</div>;
  }
  if (!data) return null;

  const { job } = data;
  const number = projectNumber(job);
  const extraTerms = (data.additionalTerms || []).filter(t => t.text && t.text.trim());
  const terms = extraTerms.length || data.proposalName
    ? extraTerms
    : STANDARD_EXCLUSIONS.map(text => ({ text, standard: true }));
  const tag = data.proposalName ? `#${number} — ${data.proposalName}` : `#${number}`;

  const scopeOptionsSlot = data.isMulti ? (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.options.map(o => <OptionCard key={o.id} o={o} />)}
    </div>
  ) : null;

  return (
    <div>
      <div className="no-print doc-toolbar">
        <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>McLoud Construction</span>
        <button className="btn btn-primary btn-sm" onClick={download} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      <ProposalDocument
        docTag={tag}
        footerLabel={`Estimate ${tag}`}
        customerName={job.customer_name}
        customerContact={job.customer_contact}
        projectAddress={job.project_address}
        description={job.description}
        price={data.price}
        scope={data.scope}
        terms={terms}
        materials={data.materials}
        scopeOptionsSlot={scopeOptionsSlot}
      />

      {data.isMulti && data.alternates.length > 0 && (
        <div className="no-print" style={{ maxWidth: 780, margin: '20px auto 0', padding: '0 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Optional alternates</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {data.alternates.map(a => <OptionCard key={a.id} o={a} />)}
          </div>
        </div>
      )}

      <div className="no-print" style={{ maxWidth: 780, margin: '24px auto 40px', padding: '0 16px', fontSize: 12.5, color: 'var(--ink-soft)', textAlign: 'center' }}>
        Questions or ready to move forward? Reach us at{' '}
        <a href="mailto:info@mcloudconstruction.com">info@mcloudconstruction.com</a>.
      </div>
    </div>
  );
}
