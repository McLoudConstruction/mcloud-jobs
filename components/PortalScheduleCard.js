'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { splitAtWeekends } from '../lib/scheduleDates';
import { phaseBackground, tradesForPhase } from '../lib/tradeColors';

// View-only mirror of the staff Schedule tab's Timeline view
// (components/ScheduleCard.js's TimelineView) — same day-grid, weekend
// shading, phase bars and trade colors, with every editing affordance
// (drag/resize, Edit, Regenerate, Add line item) stripped out. Reads
// job_phases directly, gated by migration 120's customer-scoped RLS
// policy (has_job_portal_access), same as every other portal table.
//
// This replaces the earlier "milestone stepper" idea (Contract →
// Permitting → Materials → In Progress → Punch List → Complete) — those
// steps mostly weren't backed by real data. The actual schedule staff
// already builds phase-by-phase (including a Punch List phase when one's
// added) is real data, so customers see that directly instead.

const DAY_WIDTH = 30;
const LABEL_WIDTH = 108;
const MAX_FIT_DAYS = 31;
const MOBILE_BREAKPOINT = 767;
const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function dateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
function addCalendarDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}
function weekendShading(minDate, dayWidth) {
  const firstWeekendOffset = (6 - minDate.getDay() + 7) % 7;
  const bandStart = firstWeekendOffset * dayWidth;
  const bandEnd = bandStart + 2 * dayWidth;
  const period = 7 * dayWidth;
  return `repeating-linear-gradient(to right, transparent 0px, transparent ${bandStart}px, color-mix(in srgb, var(--panel) 55%, var(--ink-soft) 20%) ${bandStart}px, color-mix(in srgb, var(--panel) 55%, var(--ink-soft) 20%) ${bandEnd}px, transparent ${bandEnd}px, transparent ${period}px)`;
}
function gridlines(dayWidth) {
  return `repeating-linear-gradient(to right, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${dayWidth}px)`;
}
function gridBackground(minDate, dayWidth) {
  return `${gridlines(dayWidth)}, ${weekendShading(minDate, dayWidth)}`;
}

function PhaseSwatch({ phase, size = 10 }) {
  return (
    <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 3, background: phaseBackground(phase), flexShrink: 0 }} />
  );
}

function legendEntries(phases) {
  const seen = new Map();
  for (const p of phases) {
    for (const t of tradesForPhase(p)) {
      if (!seen.has(t)) seen.set(t, true);
    }
  }
  return [...seen.keys()];
}

function Legend({ phases }) {
  const trades = legendEntries(phases);
  if (trades.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
      {trades.map(t => (
        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <PhaseSwatch phase={{ trade: t, phase_key: null }} />
          {t}
        </span>
      ))}
    </div>
  );
}

export default function PortalScheduleCard({ jobId }) {
  const [phases, setPhases] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const loadPhases = useCallback(async () => {
    if (!jobId) return;
    // status='published' only — a staff-side draft schedule (generated but
    // not yet published) must never be visible to the customer.
    const { data } = await supabase.from('job_phases').select('*').eq('job_id', jobId).eq('status', 'published').order('sort_order', { ascending: true });
    setPhases(data || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    loadPhases();
    const channel = supabase.channel(`portal-schedule-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_phases', filter: `job_id=eq.${jobId}` }, loadPhases)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadPhases]);

  useEffect(() => {
    function checkMobile() { setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT); }
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [phases.length]);

  if (!jobId || !loaded) return null;
  if (phases.length === 0) {
    return (
      <div className="dash-section">
        <h3>Project Schedule</h3>
        <div className="empty-state">We haven't posted a schedule for this project yet — you'll receive an email notification when this schedule is posted.</div>
      </div>
    );
  }

  const totalDays = Math.round((new Date(phases[phases.length - 1].end_date) - new Date(phases[0].start_date)) / 86400000) + 1;
  const minDate = new Date(Math.min(...phases.map(p => new Date(p.start_date + 'T00:00:00'))));
  const maxDate = new Date(Math.max(...phases.map(p => new Date(p.end_date + 'T00:00:00'))));
  const totalSpan = Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1);

  let dayWidth = DAY_WIDTH;
  if (!isMobile && containerWidth > 0) {
    const availableWidth = containerWidth - LABEL_WIDTH;
    const fitSpan = Math.min(totalSpan, MAX_FIT_DAYS);
    dayWidth = Math.max(18, availableWidth / fitSpan);
  }

  const gridWidth = totalSpan * dayWidth;
  const weekendBg = gridBackground(minDate, dayWidth);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = Math.round((today - minDate) / 86400000);
  const showToday = todayOffset >= 0 && todayOffset < totalSpan;

  const days = Array.from({ length: totalSpan }, (_, i) => addCalendarDays(minDate, i));

  return (
    <div className="dash-section">
      <h3>Project Schedule</h3>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        {fmtDate(phases[0].start_date)} – {fmtDate(phases[phases.length - 1].end_date)} · {totalDays} calendar days
      </div>

      <Legend phases={phases} />

      <div ref={containerRef} style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        <div style={{ width: LABEL_WIDTH + gridWidth }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 2, borderBottom: '1px solid var(--line)' }} />
            <div style={{ width: gridWidth, flexShrink: 0, display: 'flex', background: weekendBg, borderBottom: '1px solid var(--line)' }}>
              {days.map((d, i) => (
                <div key={i} style={{ width: dayWidth, flexShrink: 0, textAlign: 'center', padding: '4px 0' }} className={showToday && i === todayOffset ? 'schedule-today-col' : ''}>
                  <div style={{ fontSize: 8.5, color: 'var(--ink-soft)' }}>{dateLabel(d)}</div>
                  <div style={{ fontSize: 10, fontWeight: 600 }}>{DOW_LETTERS[d.getDay()]}</div>
                </div>
              ))}
            </div>
          </div>

          {phases.map(p => {
            const start = new Date(p.start_date + 'T00:00:00');
            const end = new Date(p.end_date + 'T00:00:00');
            const offsetDays = Math.round((start - minDate) / 86400000);
            const segments = splitAtWeekends(p.start_date, p.end_date, p.allow_weekend_work);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 1, padding: '6px 8px 6px 10px', fontSize: 10.5, lineHeight: 1.25 }}>
                  {p.label}
                  <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{p.duration_days}d</div>
                </div>
                <div style={{ width: gridWidth, flexShrink: 0, position: 'relative', height: 30, background: weekendBg }}>
                  {showToday && (
                    <div className="schedule-today-row" style={{ position: 'absolute', top: 0, bottom: 0, left: todayOffset * dayWidth, width: dayWidth }} />
                  )}
                  {segments.map((seg, si) => {
                    const segStart = new Date(seg.start + 'T00:00:00');
                    const segEnd = new Date(seg.end + 'T00:00:00');
                    const segOffset = Math.round((segStart - start) / 86400000);
                    const segSpan = Math.round((segEnd - segStart) / 86400000) + 1;
                    return (
                      <div
                        key={si}
                        title={`${p.label}: ${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`}
                        style={{
                          position: 'absolute', top: 5, bottom: 5,
                          left: (offsetDays + segOffset) * dayWidth + 2, width: Math.max(segSpan * dayWidth - 4, dayWidth - 4),
                          borderRadius: 4,
                          background: phaseBackground(p),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showToday && (
        <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', marginRight: 5, verticalAlign: 'middle' }} />
          Today
        </div>
      )}
    </div>
  );
}
