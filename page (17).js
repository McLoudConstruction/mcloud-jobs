'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { STAGE_LABELS, formattedProjectNumber } from '../../../lib/constants';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function toDateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function parseDateOnly(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Mon=0 .. Fri=4. Weekend dates clamp to the nearest weekday column so a
// job spanning a weekend still renders as one continuous bar across the
// adjacent Friday/Monday columns, rather than needing a gap that isn't there.
function weekdayIndex(date, clampDirection) {
  const day = date.getDay(); // 0=Sun..6=Sat
  if (day === 0) return clampDirection === 'start' ? 0 : -1; // Sunday
  if (day === 6) return clampDirection === 'start' ? -1 : 4; // Saturday
  return day - 1;
}

// Builds a full 5-column (Mon-Fri) grid of weeks covering the given month.
function buildWeeks(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstMonday = addDays(firstOfMonth, firstOfMonth.getDay() === 0 ? -6 : 1 - firstOfMonth.getDay());
  const weeks = [];
  let cursor = firstMonday;
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 5; d++) {
      week.push({ date: addDays(cursor, d), inMonth: addDays(cursor, d).getMonth() === monthDate.getMonth() });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
    if (cursor.getMonth() !== monthDate.getMonth() && cursor > addDays(firstOfMonth, 34)) break;
  }
  return weeks;
}

// Greedy lane assignment within a single week — jobs sorted by start day,
// each placed in the first lane whose existing occupant doesn't overlap
// its day-range. Lanes reset per week (a job may shift lanes week to
// week) — a deliberate simplification to keep this a real, shippable v1.
function assignLanes(jobsInWeek) {
  const lanes = []; // each lane: array of {startCol, endCol}
  const placed = [];
  const sorted = [...jobsInWeek].sort((a, b) => a.startCol - b.startCol);
  for (const job of sorted) {
    let laneIndex = lanes.findIndex(lane => lane.every(occ => job.startCol > occ.endCol || job.endCol < occ.startCol));
    if (laneIndex === -1) { laneIndex = lanes.length; lanes.push([]); }
    lanes[laneIndex].push({ startCol: job.startCol, endCol: job.endCol });
    placed.push({ ...job, lane: laneIndex });
  }
  return { placed, laneCount: lanes.length };
}

export default function JobCalendarPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();
  const [monthDate, setMonthDate] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (!session) return;
    const load = () => supabase.from('jobs').select('id, job_number, estimate_number, customer_name, stage, scheduled_start_date, scheduled_end_date')
      .not('scheduled_start_date', 'is', null)
      .then(({ data }) => { if (data) setJobs(data); });
    load();
    const channel = supabase.channel('jobs-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  const weeks = useMemo(() => buildWeeks(monthDate), [monthDate]);

  const jobBars = useMemo(() => jobs.map(j => {
    const start = parseDateOnly(j.scheduled_start_date);
    const end = j.scheduled_end_date ? parseDateOnly(j.scheduled_end_date) : start;
    return { ...j, start, end: end < start ? start : end };
  }).filter(j => j.start), [jobs]);

  if (loading || !session) return null;

  function goToday() { const t = new Date(); setMonthDate(new Date(t.getFullYear(), t.getMonth(), 1)); }
  function goPrev() { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)); }
  function goNext() { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)); }

  const today = toDateOnly(new Date());

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Calendar</h2>
          <div className="section-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-sm" onClick={goPrev}>←</button>
            <button className="btn btn-sm" onClick={goToday}>Today</button>
            <button className="btn btn-sm" onClick={goNext}>→</button>
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--heading)', marginBottom: 4 }}>
          {monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Bars run from a job's Scheduled Start Date to its Scheduled End Date — set both on a job's Project tab. Click any bar to open that job.
        </div>

        <div className="calendar-grid">
          {DAY_LABELS.map(d => <div key={d} className="calendar-day-label">{d}</div>)}
        </div>

        {weeks.map((week, wi) => {
          const weekStartCol = 0;
          const weekEndCol = 4;
          const weekStart = week[0].date;
          const weekEnd = week[4].date;

          const overlapping = jobBars
            .filter(j => j.start <= weekEnd && j.end >= weekStart)
            .map(j => {
              const startCol = j.start < weekStart ? weekStartCol : weekdayIndex(j.start, 'start');
              const endCol = j.end > weekEnd ? weekEndCol : weekdayIndex(j.end, 'end');
              return { ...j, startCol: Math.max(startCol, 0), endCol: Math.min(endCol < 0 ? weekEndCol : endCol, weekEndCol) };
            });
          const { placed, laneCount } = assignLanes(overlapping);

          return (
            <div key={wi} className="calendar-week" style={{ gridTemplateRows: `36px repeat(${Math.max(laneCount, 1)}, 30px)` }}>
              {week.map((day, di) => (
                <div
                  key={di}
                  className={`calendar-day-cell ${day.inMonth ? '' : 'calendar-day-outside'} ${sameDay(day.date, today) ? 'calendar-day-today' : ''}`}
                  style={{ gridColumn: di + 1, gridRow: `1 / ${laneCount + 2}` }}
                >
                  <span className="calendar-day-number">{day.date.getDate()}</span>
                </div>
              ))}
              {placed.map(job => (
                <div
                  key={job.id}
                  className={`calendar-bar badge-${job.stage}`}
                  style={{ gridColumn: `${job.startCol + 1} / ${job.endCol + 2}`, gridRow: job.lane + 2 }}
                  onClick={() => router.push(`/jobs/${job.id}`)}
                  title={`${formattedProjectNumber(job)} — ${job.customer_name || 'Unnamed'} (${STAGE_LABELS[job.stage]})`}
                >
                  {formattedProjectNumber(job)} {job.customer_name || ''}
                </div>
              ))}
            </div>
          );
        })}

        {jobBars.length === 0 && (
          <div className="empty-state" style={{ marginTop: 16 }}>No jobs have a Scheduled Start Date set yet.</div>
        )}
      </div>
    </AppShell>
  );
}
