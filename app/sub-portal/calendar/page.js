'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import { phaseBackground } from '../../../lib/tradeColors';
import { EVENT_TYPE_LABELS, SCHEDULE_REQUEST_STATUS_LABELS, subPortalJobHeading } from '../../../lib/constants';
import SubPortalShell from '../../../components/SubPortalShell';
import SubScheduleRequestModal from '../../../components/SubScheduleRequestModal';

// Month-view only — the GC calendar's Week/Day hourly timeline is a lot
// of extra machinery (drag-resize, a live "now" line, a synced-personal-
// calendar overlay) that a sub has no use for; the month grid is what
// they actually need — "what's coming up on jobs I've been awarded."
// Same grid classes as the GC calendar (calendar-grid/calendar-week/
// calendar-bar/cal-day-event-*, all in globals.css already) so it reads
// as the same calendar, not a lookalike.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINI_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const AWARDED_STATUSES = ['accepted', 'completed', 'invoiced', 'paid'];

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function parseDateOnly(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatEventTime(t) {
  if (!t) return 'All day';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function weekdayIndex(date) { return date.getDay(); }

function buildWeeks(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const lastOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const firstSunday = addDays(firstOfMonth, -firstOfMonth.getDay());
  const weeks = [];
  let cursor = firstSunday;
  while (cursor <= lastOfMonth) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: addDays(cursor, d), inMonth: addDays(cursor, d).getMonth() === monthDate.getMonth() });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

// Same greedy lane assignment as the GC calendar's month view — a phase
// sorted by start day, placed in the first lane whose occupant doesn't
// overlap its day range. Lanes reset per week.
function assignLanes(itemsInWeek) {
  const lanes = [];
  const placed = [];
  const sorted = [...itemsInWeek].sort((a, b) => a.startCol - b.startCol);
  for (const item of sorted) {
    let laneIndex = lanes.findIndex(lane => lane.every(occ => item.startCol > occ.endCol || item.endCol < occ.startCol));
    if (laneIndex === -1) { laneIndex = lanes.length; lanes.push([]); }
    lanes[laneIndex].push({ startCol: item.startCol, endCol: item.endCol });
    placed.push({ ...item, lane: laneIndex });
  }
  return { placed, laneCount: lanes.length };
}

export default function SubPortalCalendarPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthDate, setMonthDate] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [phases, setPhases] = useState([]);
  const [events, setEvents] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [rfpJobs, setRfpJobs] = useState([]);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const today = useMemo(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, workOrders, jobsById, ready } = useSubPortalData(session);

  const load = useCallback(async (companyId) => {
    const [{ data: phaseData }, { data: eventData }, { data: reqData }, { data: rfpData }] = await Promise.all([
      supabase.from('sub_visible_phases').select('*'),
      supabase.from('schedule_events').select('*'),
      supabase.from('schedule_requests').select('*').eq('company_id', companyId).order('requested_date', { ascending: false }),
      // Jobs visible only through an RFP (no work order yet) — pulled in
      // so "Request Schedule Event" can offer a Meeting/Site Visit on a
      // job a sub is only bidding on, not just ones they've already won.
      supabase.from('sub_visible_rfps').select('job_id, job_number, estimate_number, customer_name, stage, project_address').eq('company_id', companyId),
    ]);
    if (phaseData) setPhases(phaseData);
    if (eventData) setEvents(eventData);
    if (reqData) setMyRequests(reqData);
    if (rfpData) setRfpJobs(rfpData);
  }, []);

  useEffect(() => {
    if (!company) return;
    load(company.id);
    const channel = supabase.channel(`sub-portal-calendar-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, () => load(company.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_requests', filter: `company_id=eq.${company.id}` }, () => load(company.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_phases' }, () => load(company.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `company_id=eq.${company.id}` }, () => load(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, load]);

  // Jobs the company can request a schedule event for. Awarded — accepted-
  // or-further work orders, same bar the calendar's own phase bars use —
  // is required for most event types. All-visible adds in jobs the
  // company only knows about through an RFP (bidding, not yet won), for
  // the event types (Meeting, Site Visit) that don't require an award.
  const awardedJobs = useMemo(() => {
    const ids = [...new Set(workOrders.filter(wo => AWARDED_STATUSES.includes(wo.status)).map(wo => wo.job_id))];
    return ids.map(id => jobsById[id]).filter(Boolean);
  }, [workOrders, jobsById]);

  const allJobs = useMemo(() => {
    const byId = { ...jobsById };
    rfpJobs.forEach(r => {
      if (!r.job_id || byId[r.job_id]) return;
      byId[r.job_id] = { id: r.job_id, job_number: r.job_number, estimate_number: r.estimate_number, customer_name: r.customer_name, stage: r.stage, project_address: r.project_address };
    });
    return Object.values(byId);
  }, [jobsById, rfpJobs]);

  const phaseBars = useMemo(() => phases.map(p => ({
    id: p.id, job_id: p.job_id, label: p.label, trade: p.trade, phase_key: p.phase_key,
    start: parseDateOnly(p.start_date), end: parseDateOnly(p.end_date),
  })), [phases]);

  function timedItemsForDay(date) {
    const iso = toISODate(date);
    const items = [];
    events.filter(e => e.event_date === iso).forEach(e => {
      items.push({
        key: `evt-${e.id}`, time: e.event_time ? formatEventTime(e.event_time) : '',
        title: `${EVENT_TYPE_LABELS[e.event_type] || 'Event'}${e.description ? ': ' + e.description : ''}`,
        dotClass: 'dot-event', sortTime: e.event_time || '00:00',
      });
    });
    myRequests.filter(r => r.status === 'pending' && r.requested_date === iso).forEach(r => {
      items.push({
        key: `req-${r.id}`, time: r.requested_time ? formatEventTime(r.requested_time) : '',
        title: `Requested: ${EVENT_TYPE_LABELS[r.event_type] || 'Event'}${r.description ? ' — ' + r.description : ''}`,
        dotClass: 'dot-pending', sortTime: r.requested_time || '00:00',
      });
    });
    return items.sort((a, b) => a.sortTime.localeCompare(b.sortTime));
  }

  function prevMonth() { setMonthDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setMonthDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function selectMiniDay(d) {
    setCursorDate(d);
    if (d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) {
      setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  const weeks = buildWeeks(monthDate);
  const miniWeeks = buildWeeks(monthDate);
  const tradesPresent = [...new Set(phases.map(p => p.trade).filter(Boolean))];

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>Calendar</h3>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 18 }}>
            Phases on jobs you've been awarded, and events you've been invited to. Nothing here is editable — request a change with the button in the sidebar.
          </div>

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <div className="cal-sidebar">
              <button type="button" className="btn btn-primary cal-sidebar-create" onClick={() => setRequestModalOpen(true)}>
                + Request Schedule Event
              </button>

              <div className="cal-mini">
                <div className="cal-mini-header">
                  <span>{monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                  <span className="cal-mini-nav">
                    <button type="button" onClick={prevMonth} aria-label="Previous month">‹</button>
                    <button type="button" onClick={nextMonth} aria-label="Next month">›</button>
                  </span>
                </div>
                <div className="cal-mini-grid cal-mini-labels">
                  {MINI_DAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
                </div>
                {miniWeeks.map((week, wi) => (
                  <div key={wi} className="cal-mini-grid">
                    {week.map((day, di) => (
                      <button
                        key={di}
                        type="button"
                        className={[
                          'cal-mini-day',
                          day.inMonth ? '' : 'outside',
                          sameDay(day.date, today) ? 'today' : '',
                          sameDay(day.date, cursorDate) && !sameDay(day.date, today) ? 'selected' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => selectMiniDay(day.date)}
                      >
                        {day.date.getDate()}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="cal-sidebar-section">
                <div className="cal-sidebar-heading">Legend</div>
                <span className="cal-legend-item">
                  <span className="cal-legend-dot dot-event" />
                  Invited event
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-dot dot-pending" />
                  Your pending request
                </span>
                {tradesPresent.map(t => (
                  <span key={t} className="cal-legend-item">
                    <span className="cal-legend-dot" style={{ background: phaseBackground({ trade: t }) }} />
                    {t}
                  </span>
                ))}
              </div>

              {myRequests.length > 0 && (
                <div className="cal-sidebar-section">
                  <div className="cal-sidebar-heading">Your Requests</div>
                  {myRequests.slice(0, 6).map(r => (
                    <div key={r.id} style={{ fontSize: 11.5, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                        <span>{new Date(r.requested_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className={`badge badge-${r.status}`} style={{ fontSize: 9 }}>{SCHEDULE_REQUEST_STATUS_LABELS[r.status]}</span>
                      </div>
                      {r.description && <div style={{ color: 'var(--ink-soft)', marginTop: 1 }}>{r.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="calendar-grid">
                {DAY_LABELS.map(d => <div key={d} className="calendar-day-label">{d}</div>)}
              </div>

              {weeks.map((week, wi) => {
                const weekStart = week[0].date;
                const weekEnd = week[6].date;
                const overlapping = phaseBars
                  .filter(p => p.start && p.end && p.start <= weekEnd && p.end >= weekStart)
                  .map(p => ({
                    ...p,
                    startCol: p.start < weekStart ? 0 : weekdayIndex(p.start),
                    endCol: p.end > weekEnd ? 6 : weekdayIndex(p.end),
                  }));
                const { placed, laneCount } = assignLanes(overlapping);

                const dayItems = week.map(day => timedItemsForDay(day.date));
                const MAX_VISIBLE = 3;
                const maxLines = Math.max(1, ...dayItems.map(items => Math.min(items.length, MAX_VISIBLE) + (items.length > MAX_VISIBLE ? 1 : 0)));
                const headerHeight = Math.max(92, 28 + maxLines * 17 + 10);
                const weekRows = laneCount > 0 ? `${headerHeight}px repeat(${laneCount}, 30px)` : `${headerHeight}px`;

                return (
                  <div key={wi} className="calendar-week" style={{ gridTemplateRows: weekRows }}>
                    {week.map((day, di) => {
                      const items = dayItems[di];
                      const isToday = sameDay(day.date, today);
                      return (
                        <div
                          key={di}
                          className={[
                            'calendar-day-cell',
                            day.inMonth ? '' : 'calendar-day-outside',
                            isToday ? 'calendar-day-today' : '',
                            sameDay(day.date, cursorDate) && !isToday ? 'calendar-day-selected' : '',
                          ].filter(Boolean).join(' ')}
                          style={{ gridColumn: di + 1, gridRow: `1 / ${laneCount + 2}`, position: 'relative' }}
                          onClick={() => setCursorDate(day.date)}
                        >
                          <div className="calendar-day-number-row">
                            <span className="calendar-day-number">{day.date.getDate()}</span>
                          </div>
                          <div className="cal-day-events">
                            {items.slice(0, MAX_VISIBLE).map(item => (
                              <div key={item.key} className="cal-day-event-line" title={item.title}>
                                <span className={`cal-day-event-dot ${item.dotClass}`} />
                                {item.time && <span className="cal-day-event-time">{item.time}</span>}
                                <span className="cal-day-event-title">{item.title}</span>
                              </div>
                            ))}
                            {items.length > MAX_VISIBLE && (
                              <div className="cal-day-more">+{items.length - MAX_VISIBLE} more</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {placed.map(p => (
                      <div
                        key={p.id}
                        className="calendar-bar"
                        style={{ gridColumn: `${p.startCol + 1} / ${p.endCol + 2}`, gridRow: p.lane + 2, background: phaseBackground(p), color: '#fff' }}
                        onClick={e => { e.stopPropagation(); router.push(`/sub-portal/projects/${p.job_id}`); }}
                        title={`${p.label}${jobsById[p.job_id] ? ' — ' + subPortalJobHeading(jobsById[p.job_id]) : ''}`}
                      >
                        {p.label}
                      </div>
                    ))}
                  </div>
                );
              })}

              {phases.length === 0 && events.length === 0 && (
                <div className="empty-state" style={{ marginTop: 16 }}>Nothing on the calendar yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SubScheduleRequestModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        onCreated={() => load(company.id)}
        companyId={company.id}
        awardedJobs={awardedJobs}
        allJobs={allJobs}
        defaultDate={toISODate(cursorDate)}
      />

      <style jsx global>{`
        .calendar-day-selected{ box-shadow: inset 0 0 0 2px var(--accent); }
        .cal-sidebar{
          width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 18px;
        }
        .cal-sidebar-create{ width: 100%; text-align: center; }
        .cal-mini{ background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
        .cal-mini-header{ display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--heading); margin-bottom: 8px; }
        .cal-mini-nav{ display: flex; gap: 4px; }
        .cal-mini-nav button{ border: none; background: transparent; color: var(--ink-soft); font-size: 14px; cursor: pointer; padding: 0 4px; line-height: 1; }
        .cal-mini-nav button:hover{ color: var(--heading); }
        .cal-mini-grid{ display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-mini-labels span{ text-align: center; font-size: 9.5px; font-weight: 700; color: var(--ink-soft); padding-bottom: 4px; }
        .cal-mini-day{
          border: none; background: transparent; color: var(--ink); font-size: 11px; padding: 4px 0;
          border-radius: 50%; cursor: pointer; font-family: inherit;
        }
        .cal-mini-day:hover{ background: var(--panel); }
        .cal-mini-day.outside{ color: var(--ink-soft); opacity: 0.5; }
        .cal-mini-day.today{ background: var(--accent); color: #fff; font-weight: 700; }
        .cal-mini-day.selected{ box-shadow: inset 0 0 0 1.5px var(--accent); font-weight: 700; }
        .cal-sidebar-section{ display: flex; flex-direction: column; gap: 7px; }
        .cal-sidebar-heading{ font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 1px; }
        .cal-legend-item{ display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink); }
        .cal-legend-dot{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .cal-day-event-dot.dot-pending{ background: var(--ink-soft); border: 1px solid var(--ink-soft); }
        @media (max-width: 900px){
          .cal-sidebar{ display: none; }
        }
      `}</style>
    </SubPortalShell>
  );
}
