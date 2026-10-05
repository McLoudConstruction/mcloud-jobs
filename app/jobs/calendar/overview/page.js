'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { useRequireAuth } from '../../../../lib/useAuth';
import AppShell from '../../../../components/AppShell';
import { phaseBackground } from '../../../../lib/tradeColors';
import { STAGE_LABELS } from '../../../../lib/constants';

const ACTIVE_STAGES = ['approved', 'scheduled', 'active'];
const ZOOMS = [
  { key: 'week', label: 'Weeks', dayWidth: 28 },
  { key: 'month', label: 'Months', dayWidth: 12 },
  { key: 'quarter', label: 'Quarter', dayWidth: 5 },
];
const LABEL_W = 240;
const LANE_H = 26;

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = s => new Date(s + 'T00:00:00');
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const fmtShort = s => toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = s => toDate(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Overlapping phases in one project stack into lanes instead of hiding each other.
function layoutLanes(items) {
  const lanes = [];
  const placed = [...items].sort((a, b) => a.start_date.localeCompare(b.start_date)).map(it => {
    let lane = lanes.findIndex(end => end < it.start_date);
    if (lane === -1) { lane = lanes.length; lanes.push(it.end_date); } else lanes[lane] = it.end_date;
    return { ...it, lane };
  });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

export default function ProjectOverviewPage() {
  const { session, loading } = useRequireAuth();
  const today = iso(new Date());
  const [zoom, setZoom] = useState('month');
  const [stageFilter, setStageFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('start');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const didScroll = useRef(false);

  const load = useCallback(async () => {
    const { data: jobs, error: jobErr } = await supabase
      .from('jobs')
      .select('id, project_number, customer_name, project_address, stage')
      .in('stage', ACTIVE_STAGES);
    if (jobErr) { setError(jobErr.message); return; }
    const ids = (jobs || []).map(j => j.id);
    let phases = [];
    if (ids.length) {
      const { data: ph, error: phErr } = await supabase
        .from('job_phases')
        .select('id, job_id, label, trade, phase_key, start_date, end_date, duration_days, sort_order, allow_weekend_work, needs_review, depends_on')
        .in('job_id', ids).eq('status', 'published').order('start_date');
      if (phErr) { setError(phErr.message); return; }
      phases = ph || [];
    }
    setData({ jobs: jobs || [], phases });
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (!session) return undefined;
    const channel = supabase.channel('project-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_phases' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  const dayWidth = ZOOMS.find(z => z.key === zoom).dayWidth;

  // One row per active project, with where it is right now.
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.jobs.map(j => {
      const phases = data.phases.filter(p => p.job_id === j.id);
      const current = phases.find(p => p.start_date <= today && p.end_date >= today) || null;
      const next = phases.find(p => p.start_date > today) || null;
      const first = phases[0]?.start_date || null;
      const last = phases.reduce((m, p) => (p.end_date > m ? p.end_date : m), '') || null;
      const done = phases.filter(p => p.end_date < today).length;
      const { placed, laneCount } = layoutLanes(phases);
      return { job: j, phases: placed, laneCount, current, next, first, last, done, total: phases.length };
    })
      .filter(r => stageFilter === 'all' || r.job.stage === stageFilter)
      .filter(r => !q || `${r.job.project_number || ''} ${r.job.customer_name || ''} ${r.job.project_address || ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortBy === 'number') return String(b.job.project_number || '').localeCompare(String(a.job.project_number || ''));
        if (sortBy === 'end') return (a.last || '9999').localeCompare(b.last || '9999');
        return (a.first || '9999').localeCompare(b.first || '9999');
      });
  }, [data, today, query, stageFilter, sortBy]);

  const scheduled = rows.filter(r => r.total > 0);
  const unscheduled = rows.filter(r => r.total === 0);

  // Visible range: two weeks before today (or the earliest unfinished work) through two weeks past the last phase.
  const { rangeStart, totalDays } = useMemo(() => {
    let start = addDays(today, -14);
    let end = addDays(today, 60);
    for (const r of scheduled) {
      if (r.first && r.first < start && r.last >= today) start = r.first;
      if (r.last && r.last > end) end = r.last;
    }
    end = addDays(end, 14);
    return { rangeStart: start, totalDays: dayDiff(start, end) + 1 };
  }, [scheduled, today]);

  const gridWidth = totalDays * dayWidth;
  const todayX = dayDiff(rangeStart, today) * dayWidth + dayWidth / 2;

  // Start with today near the left edge once data is in.
  useEffect(() => {
    if (!data || didScroll.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, dayDiff(rangeStart, today) * dayWidth - 120);
    didScroll.current = true;
  }, [data, rangeStart, today, dayWidth]);

  // Month header segments.
  const months = useMemo(() => {
    const out = [];
    let cur = rangeStart;
    while (dayDiff(rangeStart, cur) < totalDays) {
      const d = toDate(cur);
      const monthEnd = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const segEnd = dayDiff(rangeStart, monthEnd) >= totalDays ? addDays(rangeStart, totalDays - 1) : monthEnd;
      out.push({ start: cur, days: dayDiff(cur, segEnd) + 1 });
      cur = addDays(segEnd, 1);
    }
    return out;
  }, [rangeStart, totalDays]);

  // Week ticks (Mondays) for the lower header.
  const weekTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      if (toDate(d).getDay() === 1) ticks.push(d);
    }
    return ticks;
  }, [rangeStart, totalDays]);

  const weekendBg = useMemo(() => {
    const firstSat = (6 - toDate(rangeStart).getDay() + 7) % 7;
    const a = firstSat * dayWidth;
    const b = a + 2 * dayWidth;
    const period = 7 * dayWidth;
    return `repeating-linear-gradient(to right, transparent 0, transparent ${a}px, var(--panel) ${a}px, var(--panel) ${b}px, transparent ${b}px, transparent ${period}px)`;
  }, [rangeStart, dayWidth]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container container-wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="tab-sections-pills">
            <Link href="/jobs/calendar" className="tab-section-btn" style={{ textDecoration: 'none' }}>Calendar</Link>
            <Link href="/jobs/calendar/board" className="tab-section-btn" style={{ textDecoration: 'none' }}>Crew board</Link>
            <span className="tab-section-btn active">Project overview</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects" style={{ width: 170 }} />
            <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">All active stages</option>
              {ACTIVE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto' }}>
              <option value="start">Sort: earliest start</option>
              <option value="end">Sort: earliest finish</option>
              <option value="number">Sort: project number</option>
            </select>
            <div className="tab-sections-pills">
              {ZOOMS.map(z => (
                <button key={z.key} type="button" className={`tab-section-btn ${zoom === z.key ? 'active' : ''}`} onClick={() => { setZoom(z.key); didScroll.current = false; }}>{z.label}</button>
              ))}
            </div>
            <button className="btn btn-sm" onClick={() => { didScroll.current = false; if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, dayDiff(rangeStart, today) * dayWidth - 120); }}>Today</button>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}
        {!data && !error && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}

        {data && (
          <>
            <div className="card" style={{ padding: 0 }}>
              <div ref={scrollRef} style={{ overflowX: 'auto' }}>
                <div style={{ width: LABEL_W + gridWidth, position: 'relative' }}>
                  {/* Header: months over week ticks */}
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, background: 'var(--card-bg)', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', borderRight: '1px solid var(--line)' }}>
                      Active projects ({rows.length})
                    </div>
                    <div style={{ width: gridWidth, flexShrink: 0 }}>
                      <div style={{ display: 'flex' }}>
                        {months.map(m => (
                          <div key={m.start} style={{ width: m.days * dayWidth, flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '5px 8px', borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {m.days * dayWidth > 90 ? monthLabel(m.start) : toDate(m.start).toLocaleDateString('en-US', { month: 'short' })}
                          </div>
                        ))}
                      </div>
                      <div style={{ position: 'relative', height: 18 }}>
                        {weekTicks.map(w => (
                          <div key={w} style={{ position: 'absolute', left: dayDiff(rangeStart, w) * dayWidth, fontSize: 9.5, color: 'var(--ink-soft)', paddingLeft: 3, borderLeft: '1px solid var(--line)', height: 18, lineHeight: '18px', whiteSpace: 'nowrap' }}>
                            {dayWidth >= 10 ? fmtShort(w) : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {scheduled.length === 0 && (
                    <div className="empty-state" style={{ margin: 16 }}>No active projects have a published schedule yet. Approved, Scheduled and Active projects appear here once their schedule is confirmed on the job's Schedule tab.</div>
                  )}

                  {scheduled.map(r => {
                    const j = r.job;
                    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
                    const href = `/jobs/${j.id}?tab=Schedule`;
                    return (
                      <div key={j.id} style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
                        <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--card-bg)', padding: '8px 12px', borderRight: '1px solid var(--line)', fontSize: 12 }}>
                          <Link href={href} style={{ fontWeight: 700, color: 'inherit' }}>
                            {j.project_number ? `#${j.project_number}` : 'Job'}{j.customer_name ? ` · ${j.customer_name}` : ''}
                          </Link>
                          {j.project_address && <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.project_address}</div>}
                          <div style={{ fontSize: 10.5, marginTop: 3 }}>
                            <span style={{ fontWeight: 600 }}>{r.current ? `Now: ${r.current.label}` : r.next ? `Next: ${r.next.label}` : 'Schedule complete'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{r.done}/{r.total}</span>
                          </div>
                        </div>
                        <div style={{ width: gridWidth, flexShrink: 0, position: 'relative', height: r.laneCount * (LANE_H + 4) + 12, background: weekendBg }}>
                          {todayX >= 0 && todayX <= gridWidth && (
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: todayX, width: 2, background: '#d23b3b', zIndex: 2, pointerEvents: 'none' }} />
                          )}
                          {r.phases.map(p => {
                            const left = dayDiff(rangeStart, p.start_date) * dayWidth;
                            const width = Math.max((dayDiff(p.start_date, p.end_date) + 1) * dayWidth - 2, 6);
                            const isNow = r.current && r.current.id === p.id;
                            const isPast = p.end_date < today;
                            return (
                              <Link
                                key={p.id}
                                href={href}
                                title={`${p.label} · ${fmtShort(p.start_date)}${p.end_date !== p.start_date ? ' to ' + fmtShort(p.end_date) : ''} · ${p.duration_days} day${p.duration_days === 1 ? '' : 's'}`}
                                style={{
                                  position: 'absolute', left, width, top: 6 + p.lane * (LANE_H + 4), height: LANE_H, zIndex: 1,
                                  background: p.needs_review ? 'var(--gold)' : phaseBackground(p),
                                  opacity: isPast ? 0.55 : 1, borderRadius: 4,
                                  outline: isNow ? '2px solid var(--ink)' : undefined, outlineOffset: 1,
                                  color: '#fff', fontSize: 11, fontWeight: 600, lineHeight: `${LANE_H}px`, padding: '0 7px',
                                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textDecoration: 'none',
                                  textShadow: '0 1px 1px rgba(0,0,0,0.4)',
                                }}
                              >
                                {p.label}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {unscheduled.length > 0 && (
              <div className="card" style={{ marginTop: 14 }}>
                <h3 style={{ marginBottom: 6 }}>No schedule yet ({unscheduled.length})</h3>
                {unscheduled.map(r => (
                  <div key={r.job.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
                    <span><b>{r.job.project_number ? `#${r.job.project_number}` : 'Job'}</b>{r.job.customer_name ? ` · ${r.job.customer_name}` : ''} <span style={{ color: 'var(--ink-soft)' }}>· {STAGE_LABELS[r.job.stage] || r.job.stage}</span></span>
                    <Link href={`/jobs/${r.job.id}?tab=Schedule`} className="btn btn-sm">Build schedule</Link>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              Each bar is a phase, colored by trade. The red line is today and the outlined bar is the phase underway. Faded bars are finished. Gold means the phase is flagged for review. Click a project or bar to open its schedule.
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
