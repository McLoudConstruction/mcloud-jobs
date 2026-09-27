'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { subPortalJobHeading } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';
import PunchPhotos from '../../../components/PunchPhotos';
import { PUNCH_STATUS, PUNCH_OPEN_STATUSES, fmtPunchDate } from '../../../lib/punch';

export default function SubPortalPunchPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, jobsById, ready } = useSubPortalData(session);

  const load = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase.from('punch_items').select('*').eq('assigned_company_id', company.id).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    setItems(data || []);
  }, [company]);

  useEffect(() => {
    if (!company) return undefined;
    load();
    const channel = supabase.channel(`sub-punch-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_items', filter: `assigned_company_id=eq.${company.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, load]);

  async function update(item, status) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('sub_update_punch_item', { target_item_id: item.id, status_in: status, note_in: note || null });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNote('');
    if (status === 'resolved') setOpenId(null);
    load();
  }

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  const shown = items.filter(i => filter === 'all' || (filter === 'open' ? PUNCH_OPEN_STATUSES.includes(i.status) : !PUNCH_OPEN_STATUSES.includes(i.status)));
  const openCount = items.filter(i => PUNCH_OPEN_STATUSES.includes(i.status)).length;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section" style={{ paddingTop: 20 }}>
          <h3>Punch list &amp; repairs</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>Fix-up items and warranty repairs assigned to your company. Mark them started and finished, and add a photo of the result.</div>
          <div className="tab-sections-pills" style={{ marginBottom: 12 }}>
            {[['open', `To do (${openCount})`], ['done', 'Closed'], ['all', 'All']].map(([k, label]) => (
              <button key={k} type="button" className={`tab-section-btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          {shown.length === 0 && <div className="empty-state">{items.length === 0 ? 'Nothing assigned to you.' : 'Nothing in this view.'}</div>}
          {shown.map(i => {
            const st = PUNCH_STATUS[i.status];
            const job = jobsById[i.job_id];
            const isOpen = openId === i.id;
            const closed = ['verified', 'declined'].includes(i.status);
            return (
              <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }} onClick={() => { setOpenId(isOpen ? null : i.id); setNote(''); setError(''); }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.priority === 'urgent' ? '⚑ ' : ''}{i.title}{i.kind === 'warranty' ? ' (warranty repair)' : ''}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                      {job ? subPortalJobHeading(job) : 'Job details unavailable'}{i.location ? ` · ${i.location}` : ''}{i.due_date ? ` · due ${fmtPunchDate(i.due_date)}` : ''}
                    </div>
                  </div>
                  <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{i.status === 'resolved' ? 'Done — awaiting sign-off' : st.label}</span>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 10 }}>
                    {i.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, marginBottom: 8 }}>{i.description}</div>}
                    {i.resolution_note && <div style={{ fontSize: 12.5, marginBottom: 8 }}><b>Your note:</b> {i.resolution_note}</div>}
                    <PunchPhotos item={i} canAdd={!closed} />
                    {!closed && (
                      <div style={{ marginTop: 12 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Note (required when marking done)</label>
                        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What you did, or what you found" />
                        <div className="section-actions">
                          {i.status === 'open' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => update(i, 'in_progress')}>Started</button>}
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !note.trim()} onClick={() => update(i, 'resolved')}>Mark done</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </SubPortalShell>
  );
}
