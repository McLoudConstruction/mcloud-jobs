'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import Breadcrumb from '../../../components/Breadcrumb';
import ComplianceVaultPanel from '../../../components/ComplianceVaultPanel';
import {
  COMPLIANCE_OVERALL, COMPLIANCE_STATUS, DOC_TYPE_BY_KEY, ENFORCEMENT_MODES, complianceGapText,
} from '../../../lib/compliance';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'review', label: 'Awaiting review' },
  { key: 'expiring', label: 'Expiring soon' },
];

function Chip({ def, children }) {
  const d = def || { color: '#6b6350', bg: '#efece2' };
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: d.color, background: d.bg, whiteSpace: 'nowrap' }}>{children}</span>
  );
}

// One-screen view of every subcontractor's compliance: who's clear, who's
// expiring, who's missing something, and what's waiting for your review.
// Status is computed by the database (sub_compliance_overview, migration
// 133) — this page only presents it.
export default function ComplianceOverviewPage() {
  const { session, loading } = useRequireAuth();
  const [rows, setRows] = useState([]);
  const [pendingByCompany, setPendingByCompany] = useState({});
  const [settings, setSettings] = useState(null);
  const [filter, setFilter] = useState('attention');
  const [openId, setOpenId] = useState(null);
  const [flash, setFlash] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const [overviewRes, pendingRes, settingsRes] = await Promise.all([
      supabase.rpc('sub_compliance_overview'),
      supabase.from('sub_compliance_docs').select('company_id').eq('status', 'pending_review'),
      supabase.from('app_settings').select('compliance_enforcement, compliance_expiring_days').eq('id', 1).maybeSingle(),
    ]);
    if (overviewRes.error) { setLoadError(overviewRes.error.message); return; }
    setLoadError('');
    setRows(overviewRes.data || []);
    const counts = {};
    (pendingRes.data || []).forEach(d => { counts[d.company_id] = (counts[d.company_id] || 0) + 1; });
    setPendingByCompany(counts);
    setSettings(settingsRes.data || null);
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    load();
    const channel = supabase.channel('compliance-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_compliance_docs' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  const totals = useMemo(() => ({
    compliant: rows.filter(r => r.overall === 'compliant' || r.overall === 'exempt').length,
    expiring: rows.filter(r => r.overall === 'expiring').length,
    noncompliant: rows.filter(r => r.overall === 'noncompliant').length,
    review: Object.values(pendingByCompany).reduce((a, b) => a + b, 0),
  }), [rows, pendingByCompany]);

  const visible = rows.filter(r => {
    if (filter === 'attention') return r.overall === 'noncompliant' || r.overall === 'expiring' || pendingByCompany[r.company_id];
    if (filter === 'review') return Boolean(pendingByCompany[r.company_id]);
    if (filter === 'expiring') return r.overall === 'expiring';
    return true;
  });

  async function nudge(row) {
    const gaps = complianceGapText(row.summary);
    const expiring = (row.summary?.required || []).filter(r => r.status === 'expiring').map(r => DOC_TYPE_BY_KEY[r.doc_type]?.label).filter(Boolean);
    const parts = [];
    if (gaps) parts.push(`we still need: ${gaps}`);
    if (expiring.length) parts.push(`expiring soon: ${expiring.join(', ')}`);
    const message = `Quick reminder to update your compliance documents — ${parts.join('; ') || 'please review what is on file'}.`;
    const { error } = await supabase.from('portal_notifications').insert({
      recipient_kind: 'subcontractor',
      company_id: row.company_id,
      category: 'compliance_expiring',
      message,
      link_path: '/sub-portal/settings',
    });
    setFlash(error ? `Couldn't send: ${error.message}` : `Reminder sent to ${row.company_name}.`);
    setTimeout(() => setFlash(''), 4000);
  }

  if (loading || !session) return null;

  const enforcement = ENFORCEMENT_MODES.find(m => m.key === settings?.compliance_enforcement);

  return (
    <AppShell>
      <div className="container container-wide">
        <Breadcrumb href="/subcontractors" label="Subcontractors" />
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Compliance</h2>
        </div>
        {enforcement && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 14px' }}>
            Enforcement: <b>{enforcement.label}</b>. Change this and the required documents in Settings.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Compliant', value: totals.compliant, def: COMPLIANCE_OVERALL.compliant },
            { label: 'Expiring soon', value: totals.expiring, def: COMPLIANCE_OVERALL.expiring },
            { label: 'Non-compliant', value: totals.noncompliant, def: COMPLIANCE_OVERALL.noncompliant },
            { label: 'Awaiting review', value: totals.review, def: COMPLIANCE_STATUS.pending },
          ].map(t => (
            <div key={t.label} className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: t.def.color, lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{t.label}</div>
            </div>
          ))}
        </div>

        <div className="segmented" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: '7px 14px', border: 'none', borderRight: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5,
                background: filter === f.key ? 'var(--heading)' : 'transparent', color: filter === f.key ? '#fff' : 'inherit', fontWeight: filter === f.key ? 700 : 400,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {flash && <div style={{ fontSize: 12.5, color: '#3a6b45', marginBottom: 10 }}>{flash}</div>}
        {loadError && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 10 }}>{loadError} — make sure migration 133 has been run.</div>}

        {visible.length === 0 && !loadError && (
          <div className="empty-state">{filter === 'all' ? 'No subcontractors yet.' : 'Nothing here — every subcontractor is in good shape.'}</div>
        )}

        {visible.map(r => {
          const pending = pendingByCompany[r.company_id] || 0;
          const isOpen = openId === r.company_id;
          return (
            <div key={r.company_id} className="card" style={{ margin: '0 0 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.company_name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <Chip def={COMPLIANCE_OVERALL[r.overall]}>{COMPLIANCE_OVERALL[r.overall]?.label || r.overall}</Chip>
                    {(r.summary?.required || []).map(item => (
                      <Chip key={item.doc_type} def={COMPLIANCE_STATUS[item.status]}>
                        {DOC_TYPE_BY_KEY[item.doc_type]?.short || item.doc_type}: {COMPLIANCE_STATUS[item.status]?.label || item.status}
                        {item.days_left !== null && item.days_left !== undefined && item.status !== 'missing' ? ` (${item.days_left < 0 ? 'expired' : `${item.days_left}d`})` : ''}
                      </Chip>
                    ))}
                    {pending > 0 && <Chip def={COMPLIANCE_STATUS.pending}>{pending} to review</Chip>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(r.overall === 'noncompliant' || r.overall === 'expiring') && (
                    <button type="button" className="btn btn-sm" onClick={() => nudge(r)}>Send reminder</button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => setOpenId(isOpen ? null : r.company_id)}>{isOpen ? 'Close' : 'Open'}</button>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <ComplianceVaultPanel companyId={r.company_id} onChanged={load} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
