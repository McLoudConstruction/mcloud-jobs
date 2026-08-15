'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useRequireAuth } from '../../../../../lib/useAuth';

const LOGO_SRC = '/mcloud-logo.png';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpdateDocumentPage() {
  const { session, loading } = useRequireAuth();
  const { id, updateId } = useParams();
  const [job, setJob] = useState(null);
  const [update, setUpdate] = useState(null);

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: updateData }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('job_updates').select('*').eq('id', updateId).single(),
    ]);
    if (jobData) setJob(jobData);
    if (updateData) setUpdate(updateData);
  }, [id, updateId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  function printDocument() { window.print(); }

  if (loading || !session || !job || !update) return null;

  const field = (label, value) => value ? (
    <div className="section">
      <h3>{label}</h3>
      <p>{value}</p>
    </div>
  ) : null;

  return (
    <div>
      <div className="no-print" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#d3d0b5', borderBottom: '1px solid #c4c1a6' }}>
        <Link href={`/jobs/${id}`} className="btn btn-sm">← Back to job</Link>
        <button className="btn btn-primary btn-sm" onClick={printDocument}>↓ Download / Print as PDF</button>
      </div>

      <div className="doc-outer">
        <div className="doc-page">
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

            <div className="doc-footer">
              <span>Stachys — McLoud Construction</span>
              <span>Est. completion: {fmtDate(update.estimated_completion)}</span>
            </div>
          </div>
        </div>
      </div>

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
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        @media print { .no-print { display: none !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
