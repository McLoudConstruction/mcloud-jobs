'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';
import { generatePdfBase64, base64ToPdfUrl } from '../../../../../lib/generatePdf';

const LOGO_SRC = '/mcloud-logo.png';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpdateDocumentPage() {
  const { session, loading } = useDocumentAuth();
  const { id, updateId } = useParams();
  const [job, setJob] = useState(null);
  const [update, setUpdate] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [photoUrls, setPhotoUrls] = useState([]);

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: updateData }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('job_updates').select('*').eq('id', updateId).single(),
    ]);
    if (jobData) setJob(jobData);
    if (updateData) setUpdate(updateData);

    const { data: photos } = await supabase.from('job_photos').select('*').eq('update_id', updateId).order('created_at', { ascending: true });
    if (photos && photos.length) {
      const urls = await Promise.all(
        photos.map(async p => {
          const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
          return data?.signedUrl;
        })
      );
      setPhotoUrls(urls.filter(Boolean));
    } else {
      setPhotoUrls([]);
    }
  }, [id, updateId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  const [downloading, setDownloading] = useState(false);

  async function downloadDocument() {
    setDownloading(true);
    try {
      const base64 = await generatePdfBase64('doc-preview', `Project-Update-${job.job_number}-${update.update_date}.pdf`);
      window.open(base64ToPdfUrl(base64), '_blank');
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session || !job || !update) return null;

  const field = (label, value) => value ? (
    <div className="section">
      <h3>{label}</h3>
      <p>{value}</p>
    </div>
  ) : null;

  const recipientEmail = job.billing_email || job.customer_email || '';

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={session?.user?.app_metadata?.role === 'admin' ? `/jobs/${id}` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download/Print Document'}
          </button>
          {session?.user?.app_metadata?.role === 'admin' && (
            <button className="btn btn-sm" onClick={() => setModalOpen(true)}>Send to Customer</button>
          )}
        </div>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={LOGO_SRC} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Project Update</div>
          </div>
          <div className="doc-body">
            <h1 className="doc-title">Project Update</h1>
            <div className="doc-meta">
              <span><b>{job.customer_name || 'Customer name'}</b></span>
              <span>{job.project_address || 'Project address'}</span>
              <span>Date: <b>{fmtDate(update.update_date)}</b></span>
            </div>

            {field('Work completed', update.work_completed)}
            {field('Upcoming work', update.upcoming_work)}
            {field('Issues / notes', update.issues_notes)}
            {field('Next steps', update.next_steps)}

            {photoUrls.length > 0 && (
              <div className="section">
                <h3>Photos</h3>
                <div className="doc-photo-grid">
                  {photoUrls.map((url, i) => (
                    <img key={i} src={url} alt="" className="doc-photo" />
                  ))}
                </div>
              </div>
            )}

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Est. completion: {fmtDate(update.estimated_completion)}</span>
            </div>
          </div>
        </div>
      </div>

      <SendDocModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        docLabel="Project Update"
        docType="project update"
        customerName={job.customer_contact || job.customer_name}
        docElementId="doc-preview"
        jobId={id}
        pdfFilename={`Project-Update-${job.job_number}-${update.update_date}.pdf`}
        defaultEmail={recipientEmail}
        onSendSuccess={async () => {
          await supabase.from('job_updates').update({ sent_at: new Date().toISOString() }).eq('id', updateId);
        }}
      />

      <style jsx global>{`
        body { background: #dbd8bf; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 800px; min-height: 700px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 48px; display: flex; align-items: center; gap: 16px; border-bottom: 5px solid #dbd8bf; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9b773d; }
        .doc-body { padding: 38px 48px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9b773d; margin: 0 0 18px; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 30px; border-bottom: 1px solid #ded7c0; }
        .section { margin-bottom: 22px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9b773d; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #dbd8bf; }
        .section p { font-size: 13.5px; line-height: 1.6; color: #221f16; margin: 0; white-space: pre-wrap; }
        .doc-photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .doc-photo { width: 100%; height: 160px; object-fit: cover; border-radius: 4px; border: 1px solid #ded7c0; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .continued-note { display: none; font-size: 11px; font-style: italic; color: #6b6350; text-align: center; padding-top: 14px; margin-bottom: 10px; border-top: 1px dashed #ded7c0; }
        @media print { .continued-note { display: block; } .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
