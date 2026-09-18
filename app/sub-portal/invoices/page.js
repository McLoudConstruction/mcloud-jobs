'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { formattedProjectNumber } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SubPortalInvoicesPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, workOrders, jobsById, ready } = useSubPortalData(session);

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  const invoiceWorkOrders = workOrders.filter(wo => ['invoiced', 'paid'].includes(wo.status));

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="card" style={{ padding: '4px 24px' }}>
          <div className="dash-section" style={{ paddingTop: 18 }}>
            <h3>Invoices</h3>
            {invoiceWorkOrders.length === 0 && <div className="empty-state">Nothing invoiced yet.</div>}
            {invoiceWorkOrders.map(wo => {
              const job = jobsById[wo.job_id];
              return (
                <Link key={wo.id} href={`/sub-portal/work-orders/${wo.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{job ? job.project_address || formattedProjectNumber(job) : 'Job details unavailable'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{wo.description}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {role === 'admin' && <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(wo.amount)}</div>}
                      {wo.status === 'paid' ? (
                        <div style={{ fontSize: 11.5, color: '#3a6b45', fontWeight: 600, marginTop: 2 }}>Paid {fmtDate(wo.paid_at)}</div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Invoiced — awaiting payment</div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </SubPortalShell>
  );
}
