'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useRequireAuth } from '../../../../lib/useAuth';
import AppShell from '../../../../components/AppShell';
import { phaseBackground } from '../../../../lib/tradeColors';
import { findConflicts } from '../../../../lib/scheduleConflicts';

const DAYS = 28; // four weeks on screen
const ACTIVE_STAGES = ['approved', 'scheduled', 'active'];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const fmtShort = s => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const SEVERITY = {
  high: { label: 'Conflict', color: '#a13f3f', bg: '#fbeae7' },
  medium: { label: 'Check', color: '#a17c3f', bg: '#f7efdc' },
  info: { label: 'Heads-up', color: '#2f4858', bg: '#e6edf1' },
};

// Greedy lane assignment so overlapping bars in one row stack instead of hiding each other.
function layoutLanes(items) {
  const lanes = [];
  const placed = [...items].sort((a, b) => a.start.localeCompare(b.start)).map(it => {
    let lane = lanes.findIndex(end => end < it.start);
    if (lane === -1) { lane = lanes.length; lanes.push(it.end); } else lanes[lane] = it.end;
    return { ...it, lane };
  });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

export default function ScheduleBoardPage() {
  const { session, loading } = useRequireAuth();
  const today = iso(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [view, setView] = useState('job');
  const [showInfo, setShowInfo] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data: jobs, error: jobErr } = await supabase.from('jobs').select('id, job_number, customer_name, project_address, stage').in('stage', ACTIVE_STAGES);
    if (jobErr) { setError(jobErr.message); return; }
    const jobIds = (jobs || []).map(j => j.id);
    if (!jobIds.length) { setData({ jobs: [], phases: [], workOrders: [], companies: {}, unavailability: [], compliance: {} }); return; }
    const [ph, wo, un, ov] = await Promise.all([
      supabase.from('job_phases').select('id, job_id, label, trade, phase_key, start_date, end_date, allow_weekend_work, needs_review').in('job_id', jobIds).eq('status', 'published').order('start_date'),
      supabase.from('work_orders').select('id, job_id, company_id, trade, status').in('job_id', jobIds),
      supabase.from('company_unavailability').select('*').gte('end_date', addDays(today, -1)),
      supabase.rpc('sub_compliance_overview'),
    ]);
    const cids = [...new Set([...(wo.data || []).map(w => w.company_id), ...(un.data || []).map(u => u.company_id)].filter(Boolean))];
    let companies = {};
    if (cids.length) {
      const { data: cs } = await supabase.from('companies').select('id, company_name').in('id', cids);
      companies = Object.fromEntries((cs || []).map(c => [c.id, c.company_name]));
    }
    setData({
      jobs: jobs || [], phases: ph.data || [], workOrders: wo.data || [], companies,
      unavailability: un.data || [], compliance: Object.fromEntries((ov.data || []).map(r => [r.company_id, r])),
    });
  }, [today]);

  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (!session) return undefined;
    const channel = supabase.channel('schedule-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_phases' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_unavailability' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  const jobsById = useMemo(() => Object.fromEntries((data?.jobs || []).map(j => [j.id, j])), [data]);

  const conflicts = useMemo(() => {
    if (!data) return [];
    return findConflicts({ phases: data.phases, jobsById, workOrders: data.workOrders, unavailability: data.unavailability, compliance: data.compliance, companies: data.companies, today });
  }, [data, jobsById, today]);

  const shownConflicts = conflicts.filter(c => showInfo || c.severity !== 'info');
  const conflictedPhaseIds = useMemo(() => new Set(conflicts.filter(c => c.severity === 'high').flatMap(c => c.phaseIds)), [conflicts]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i));
  const endOfWindow = days[DAYS - 1];
  const inWindow = (s, e) => e >= weekStart && s <= endOfWindow;
  const col = s => Math.max(0, Math.min(DAYS - 1, dayDiff(weekStart, s)));

  // Rows for the chosen view
  const rows = useMemo(() => {
    if (!data) return [];
    const phaseItem = (p, extra = {}) => ({ key: p.id + (extra.suffix || ''), start: p.start_date, end: p.end_date, label: extra.label || p.label, phase: p, ...extra });
    if (view === 'job') {
      return data.jobs.map(j => {
        const items = data.phases.filter(p => p.job_id === j.id && inWindow(p.start_date, p.end_date)).map(p => phaseItem(p));
        return { id: j.id, title: j.job_number ? `#${j.job_number} · ${j.customer_name || ''}` : (j.customer_name || 'Job'), sub: j.project_address, href: `/jobs/${j.id}?tab=Schedule`, items };
      }).filter(r => r.items.length);
    }
    // by sub
    const active = data.workOrders.filter(w => w.company_id && ['issued', 'accepted'].includes(w.status));
    const cids = [...new Set([...active.map(w => w.company_id), ...data.unavailability.map(u => u.company_id)])];
    return cids.map(cid => {
      const items = [];
      for (const p of data.phases) {
        if (!p.trade || !inWindow(p.start_date, p.end_date)) continue;
        if (active.some(w => w.company_id === cid && w.job_id === p.job_id && w.trade === p.trade)) {
          const j = jobsById[p.job_id];
          items.push(phaseItem(p, { suffix: '-' + cid, label: `${j?.job_number ? '#' + j.job_number + ' ' : ''}${p.label}` }));
        }
      }
      for (const u of data.unavailability.filter(x => x.company_id === cid && inWindow(x.start_date, x.end_date))) {
        items.push({ key: 'u' + u.id, start: u.start_date, end: u.end_date, label: u.reason ? `Unavailable — ${u.reason}` : 'Unavailable', off: true });
      }
      const comp = data.compliance[cid];
      return { id: cid, title: data.companies[cid] || 'Subcontractor', sub: comp?.overall === 'noncompliant' ? 'Not compliant' : '', items };
    }).filter(r => r.items.length).sort((a, b) => a.title.localeCompare(b.title));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view, weekStart, jobsById]);

  if (loading || !session) return null;

  const gridCols = `repeat(${DAYS}, minmax(26px, 1fr))`;

  return (
    <AppShell>
      <div className="container container-wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="tab-sections-pills">
            <Link href="/jobs/calendar" className="tab-section-btn" style={{ textDecoration: 'none' }}>Calendar</Link>
            <span className="tab-section-btn active">Crew board</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="tab-sections-pills">
              <button type="button" className={`tab-section-btn ${view === 'job' ? 'active' : ''}`} onClick={() => setView('job')}>By job</button>
              <button type="button" className={`tab-section-btn ${view === 'sub' ? 'active' : ''}`} onClick={() => setView('sub')}>By subcontractor</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Week</button>
              <button className="btn btn-sm" onClick={() => setWeekStart(mondayOf(today))}>Today</button>
              <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Week ›</button>
            </div>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}
        {!data && !error && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}

        {data && (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>
                  {shownConflicts.filter(c => c.severity === 'high').length > 0
                    ? `${shownConflicts.filter(c => c.severity === 'high').length} scheduling conflict${shownConflicts.filter(c => c.severity === 'high').length === 1 ? '' : 's'}`
                    : 'No scheduling conflicts'}
                </h3>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 400, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={showInfo} onChange={e => setShowInfo(e.target.checked)} />
                  Also show heads-ups (trade starting soon with no work order)
                </label>
              </div>
              {shownConflicts.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>Nothing overlaps, no sub is booked twice, and nobody is scheduled on days they marked unavailable.</div>}
              {shownConflicts.map(c => {
                const sev = SEVERITY[c.severity];
                const jobId = c.jobIds?.[0];
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: sev.color, background: sev.bg, whiteSpace: 'nowrap', marginTop: 1 }}>{sev.label}</span>
                    <span style={{ flex: 1 }}>{c.message}</span>
                    {jobId && <Link href={`/jobs/${jobId}?tab=Schedule`} className="btn btn-sm">Open</Link>}
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ minWidth: 900 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>{view === 'job' ? 'Job' : 'Subcontractor'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: gridCols }}>
                    {days.map((d, i) => {
                      const wk = new Date(d + 'T00:00:00').getDay();
                      const weekend = wk === 0 || wk === 6;
                      return (
                        <div key={d} style={{ textAlign: 'center', fontSize: 9.5, padding: '4px 0', background: weekend ? 'var(--panel)' : undefined, color: d === today ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: d === today ? 700 : 400, borderLeft: i % 7 === 0 ? '1px solid var(--line)' : undefined }}>
                          {i % 7 === 0 ? fmtShort(d) : new Date(d + 'T00:00:00').getDate()}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {rows.length === 0 && <div className="empty-state" style={{ margin: 16 }}>Nothing scheduled in these four weeks. Only Approved, Scheduled and Active jobs with a published schedule appear here.</div>}

                {rows.map(r => {
                  const { placed, laneCount } = layoutLanes(r.items);
                  return (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ padding: '8px 12px', fontSize: 12 }}>
                        {r.href ? <Link href={r.href} style={{ fontWeight: 600, color: 'inherit' }}>{r.title}</Link> : <span style={{ fontWeight: 600 }}>{r.title}</span>}
                        {r.sub && <div style={{ fontSize: 10.5, color: r.sub === 'Not compliant' ? '#a13f3f' : 'var(--ink-soft)' }}>{r.sub}</div>}
                      </div>
                      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: gridCols, gridAutoRows: 24, rowGap: 3, padding: '5px 0', gridTemplateRows: `repeat(${laneCount}, 24px)` }}>
                        {days.map((d, i) => {
                          const wk = new Date(d + 'T00:00:00').getDay();
                          return <div key={d} style={{ gridColumn: i + 1, gridRow: `1 / span ${laneCount}`, background: wk === 0 || wk === 6 ? 'var(--panel)' : undefined, opacity: 0.6, borderLeft: i % 7 === 0 ? '1px solid var(--line)' : undefined, outline: d === today ? '1px solid var(--accent)' : undefined, outlineOffset: -1 }} />;
                        })}
                        {placed.map(it => {
                          const c0 = col(it.start) + 1;
                          const c1 = col(it.end) + 2;
                          const bad = it.phase && conflictedPhaseIds.has(it.phase.id);
                          return (
                            <div
                              key={it.key}
                              title={`${it.label} · ${fmtShort(it.start)}${it.end !== it.start ? ' – ' + fmtShort(it.end) : ''}`}
                              style={{
                                gridColumn: `${c0} / ${c1}`, gridRow: it.lane + 1, zIndex: 1,
                                background: it.off ? 'repeating-linear-gradient(45deg, #e3b5ab, #e3b5ab 4px, #fbeae7 4px, #fbeae7 8px)' : (it.phase?.needs_review ? 'var(--gold)' : phaseBackground(it.phase)),
                                color: it.off ? '#a13f3f' : '#fff', borderRadius: 4, fontSize: 10.5, fontWeight: 600, padding: '0 6px', lineHeight: '24px',
                                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textShadow: it.off ? 'none' : '0 1px 1px rgba(0,0,0,0.35)',
                                outline: bad ? '2px solid #a13f3f' : undefined, outlineOffset: 1,
                              }}
                            >
                              {it.label}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              A sub appears on a phase when they hold an issued or accepted work order for that trade on the job. Red outline = a conflict above. Striped = the sub marked themselves unavailable.
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
