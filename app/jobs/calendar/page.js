'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import PopupModal from '../../../components/PopupModal';
import MobileFab from '../../../components/MobileFab';
import NewEventModal from '../../../components/NewEventModal';
import { STAGE_LABELS, EVENT_TYPE_LABELS, formattedProjectNumber } from '../../../lib/constants';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINI_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The stages a job actually gets scheduled at — the fixed key the legend
// always shows, not just whichever ones happen to be on the calendar right
// now. A brand-new company with two test jobs would otherwise see a legend
// with one entry in it, which reads as broken rather than "nothing else is
// scheduled yet."
const SCHEDULABLE_STAGES = ['approved', 'scheduled', 'active', 'completed'];

function toDateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function parseDateOnly(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatEventTime(t) {
  if (!t) return 'All day';
  const [h, m] = t.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
// Sun=0 .. Sat=6 — every day of the week gets its own column now, so this
// is just the day-of-week index with no weekend clamping needed.
function weekdayIndex(date) {
  return date.getDay();
}

// --- Hourly timeline grid (desktop Week/Day views) ---------------------
// Modeled on Google Calendar's own Day/Week layout: a fixed-height hour
// row, events positioned by real clock time instead of listed in an
// agenda, and a live red "now" line on today's column.
const HOUR_HEIGHT = 48; // px per hour
function minutesSinceMidnight(d) { return d.getHours() * 60 + d.getMinutes(); }
function topPxForTime(d) { return (minutesSinceMidnight(d) / 60) * HOUR_HEIGHT; }
function topPxForTimeStr(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return ((h * 60 + (m || 0)) / 60) * HOUR_HEIGHT;
}
const HOUR_ROWS = Array.from({ length: 24 }, (_, i) => i);
function formatHourLabel(h) {
  if (h === 0) return '';
  const d = new Date(2000, 0, 1, h, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric' });
}

// Builds a 7-column (Sun-Sat) grid of weeks covering the given month —
// only the weeks that actually contain a day inside that month (4, 5, or
// 6 depending on the month/year), never a trailing all-outside week.
// Shared by the main Month view and the sidebar mini month-picker.
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

// The persistent left-rail: a "+ New Event" action, a mini month-picker for
// fast navigation, and the filter/legend area — modeled directly on Google
// Calendar's own left sidebar (Create button, mini calendar, calendar list).
// This is the piece the redesign doc called for and the first pass of the
// 7-day-grid work skipped; it's real state now (the toggles actually hide
// their overlay), not decoration.
function CalendarSidebar({
  monthDate, cursorDate, today, onSelectDay, onPrevMonth, onNextMonth, onNewEvent,
  showJobs, setShowJobs, showBidWalks, setShowBidWalks, showScheduleEvents, setShowScheduleEvents, showPersonal, setShowPersonal,
}) {
  const miniWeeks = useMemo(() => buildWeeks(monthDate), [monthDate]);
  return (
    <div className="cal-sidebar">
      <button type="button" className="btn btn-primary cal-sidebar-create" onClick={onNewEvent}>+ New Event</button>

      <div className="cal-mini">
        <div className="cal-mini-header">
          <span>{monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <span className="cal-mini-nav">
            <button type="button" onClick={onPrevMonth} aria-label="Previous month">‹</button>
            <button type="button" onClick={onNextMonth} aria-label="Next month">›</button>
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
                onClick={() => onSelectDay(day.date)}
              >
                {day.date.getDate()}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="cal-sidebar-section">
        <div className="cal-sidebar-heading">Show on calendar</div>
        <label className="cal-sidebar-toggle">
          <input type="checkbox" checked={showJobs} onChange={e => setShowJobs(e.target.checked)} />
          Jobs
        </label>
        <label className="cal-sidebar-toggle">
          <input type="checkbox" checked={showBidWalks} onChange={e => setShowBidWalks(e.target.checked)} />
          🔨 Bid walks
        </label>
        <label className="cal-sidebar-toggle">
          <input type="checkbox" checked={showScheduleEvents} onChange={e => setShowScheduleEvents(e.target.checked)} />
          📌 Events
        </label>
        <label className="cal-sidebar-toggle">
          <input type="checkbox" checked={showPersonal} onChange={e => setShowPersonal(e.target.checked)} />
          📅 Personal (synced)
        </label>
      </div>

      <div className="cal-sidebar-section">
        <div className="cal-sidebar-heading">Job stage colors</div>
        {SCHEDULABLE_STAGES.map(s => (
          <span key={s} className="cal-legend-item">
            <span className={`cal-legend-dot badge-${s}`} />
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function JobCalendarPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [defaultViewApplied, setDefaultViewApplied] = useState(false);
  const [view, setView] = useState('month'); // 'month' | 'week' | 'day'
  const [monthDate, setMonthDate] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [cursorDate, setCursorDate] = useState(() => toDateOnly(new Date()));
  const [jobs, setJobs] = useState([]);
  const [busyEvents, setBusyEvents] = useState([]);
  const [bidWalks, setBidWalks] = useState([]);
  const [previewJob, setPreviewJob] = useState(null);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [staffById, setStaffById] = useState({});
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [previewEvent, setPreviewEvent] = useState(null);
  const [deletingEvent, setDeletingEvent] = useState(false);

  // Sidebar filter toggles — what's actually plotted on the calendar today
  // (job bars, bid walks, manually-created events, synced personal busy
  // blocks). All on by default; unchecking one hides that overlay
  // everywhere (Month grid day badges/bars and the Week/Day agenda list).
  const [showJobs, setShowJobs] = useState(true);
  const [showBidWalks, setShowBidWalks] = useState(true);
  const [showScheduleEvents, setShowScheduleEvents] = useState(true);
  const [showPersonal, setShowPersonal] = useState(true);

  // Ticks once a minute to move the live current-time indicator on the
  // desktop Week/Day timeline grid without needing a full page refresh.
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const gmtLabel = useMemo(() => {
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    return `GMT${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
  }, []);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  // Mobile defaults to the agenda-style Week view instead of the dense
  // Month grid — this only steers the initial view once, so it doesn't
  // fight a person who deliberately switches to Month afterward.
  useEffect(() => {
    if (isMobile && !defaultViewApplied) {
      setView('week');
      setDefaultViewApplied(true);
    }
  }, [isMobile, defaultViewApplied]);

  useEffect(() => {
    if (!session) return;
    const load = () => supabase.from('jobs').select('id, job_number, estimate_number, customer_name, stage, scheduled_start_date, scheduled_end_date')
      .not('scheduled_start_date', 'is', null)
      .then(({ data }) => { if (data) setJobs(data); });
    load();
    const channel = supabase.channel('jobs-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  // Bid walks / inspections scheduled on leads (Sales page) — plotted as
  // individual events alongside job bars, not just synced out to a
  // personal calendar.
  useEffect(() => {
    if (!session) return;
    const load = () => supabase.from('opportunities').select('id, contact_name, project, bid_walk_scheduled_at')
      .not('bid_walk_scheduled_at', 'is', null)
      .then(({ data }) => { if (data) setBidWalks(data); });
    load();
    const channel = supabase.channel('opportunities-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  // Manually-created calendar events (schedule_events) from the "New
  // Event" flow, plus the active staff directory so an event's
  // assigned-staff ids can be shown as names in the preview popup.
  const loadScheduleEvents = useCallback(async () => {
    const { data } = await supabase.from('schedule_events').select('*').order('event_date', { ascending: true });
    if (data) setScheduleEvents(data);
  }, []);
  useEffect(() => {
    if (!session) return;
    loadScheduleEvents();
    supabase.from('staff_users').select('id, full_name').eq('status', 'active').then(({ data }) => {
      if (data) setStaffById(Object.fromEntries(data.map(s => [s.id, s.full_name])));
    });
    const channel = supabase.channel('schedule-events-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, loadScheduleEvents).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadScheduleEvents]);

  const weeks = useMemo(() => buildWeeks(monthDate), [monthDate]);

  // Personal calendar events (Google/Microsoft) synced in via
  // Settings → Integrations, cached in external_busy_events and
  // overlaid here so the office can see when someone's got something
  // personal going on, without seeing full calendar details.
  useEffect(() => {
    if (!session || weeks.length === 0) return;
    const rangeStart = weeks[0][0].date;
    const rangeEnd = addDays(weeks[weeks.length - 1][6].date, 1);
    supabase
      .from('external_busy_events')
      .select('title, start_at, end_at')
      .lt('start_at', rangeEnd.toISOString())
      .gt('end_at', rangeStart.toISOString())
      .then(({ data }) => setBusyEvents(data || []));
  }, [session, weeks]);

  function busyForDay(date) {
    const dayStart = toDateOnly(date);
    const dayEnd = addDays(dayStart, 1);
    return busyEvents.filter(e => new Date(e.start_at) < dayEnd && new Date(e.end_at) > dayStart);
  }

  function bidWalksForDay(date) {
    const dayStart = toDateOnly(date);
    const dayEnd = addDays(dayStart, 1);
    return bidWalks.filter(b => { const at = new Date(b.bid_walk_scheduled_at); return at >= dayStart && at < dayEnd; })
      .sort((a, b) => new Date(a.bid_walk_scheduled_at) - new Date(b.bid_walk_scheduled_at));
  }

  function scheduleEventsForDay(date) {
    const day = toDateOnly(date);
    return scheduleEvents.filter(ev => sameDay(parseDateOnly(ev.event_date), day))
      .sort((a, b) => (a.event_time || '').localeCompare(b.event_time || ''));
  }

  function jobsForDay(date) {
    const day = toDateOnly(date);
    return jobBars.filter(j => j.start <= day && j.end >= day);
  }

  // The Month grid's per-day timed-item list — schedule events, bid
  // walks, and synced personal blocks, merged and sorted by clock time so
  // they read top-to-bottom the way Google's day cell does. Job bars stay
  // out of this list; they're already their own full-width bar.
  function timedItemsForDay(date) {
    const items = [];
    if (showScheduleEvents) {
      scheduleEventsForDay(date).forEach(ev => {
        const [h, m] = (ev.event_time || '').split(':').map(Number);
        items.push({
          key: `ev-${ev.id}`,
          sortMinutes: ev.event_time ? h * 60 + (m || 0) : -1,
          time: ev.event_time ? formatEventTime(ev.event_time) : null,
          title: ev.description || EVENT_TYPE_LABELS[ev.event_type],
          dotClass: 'dot-event',
          onClick: () => setPreviewEvent(ev),
        });
      });
    }
    if (showBidWalks) {
      bidWalksForDay(date).forEach(b => {
        const at = new Date(b.bid_walk_scheduled_at);
        items.push({
          key: `bw-${b.id}`,
          sortMinutes: at.getHours() * 60 + at.getMinutes(),
          time: at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          title: `Bid walk — ${b.contact_name || 'Lead'}`,
          dotClass: 'dot-bidwalk',
          onClick: null,
        });
      });
    }
    if (showPersonal) {
      busyForDay(date).forEach((b, i) => {
        const at = new Date(b.start_at);
        items.push({
          key: `busy-${date.toDateString()}-${i}`,
          sortMinutes: at.getHours() * 60 + at.getMinutes(),
          time: null,
          title: `${b.title} (personal)`,
          dotClass: 'dot-personal',
          onClick: null,
        });
      });
    }
    return items.sort((a, b) => a.sortMinutes - b.sortMinutes);
  }

  const jobBars = useMemo(() => jobs.map(j => {
    const start = parseDateOnly(j.scheduled_start_date);
    const end = j.scheduled_end_date ? parseDateOnly(j.scheduled_end_date) : start;
    return { ...j, start, end: end < start ? start : end };
  }).filter(j => j.start), [jobs]);

  // Mobile month navigation: a horizontally scrollable strip of month
  // chips (like a Google Calendar month/year switcher) in place of the
  // prev/Today/next arrows — 3 months back through 8 months ahead of the
  // real current month, regardless of which month is currently shown.
  const monthChips = useMemo(() => {
    const t = new Date();
    const base = new Date(t.getFullYear(), t.getMonth(), 1);
    return Array.from({ length: 12 }, (_, i) => new Date(base.getFullYear(), base.getMonth() - 3 + i, 1));
  }, []);

  // Every hook above this line must run on every render, loading or not —
  // this early return has to come after all of them, or the hook count
  // changes between the loading render and the real one (React error #310,
  // seen as a hard crash on this page once the timeline-grid hooks were
  // added above the old return point).
  if (loading || !session) return null;

  function goToday() {
    const t = toDateOnly(new Date());
    setMonthDate(new Date(t.getFullYear(), t.getMonth(), 1));
    setCursorDate(t);
  }
  function goPrev() {
    if (view === 'month') { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)); return; }
    setCursorDate(prev => addDays(prev, view === 'week' ? -7 : -1));
  }
  function goNext() {
    if (view === 'month') { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)); return; }
    setCursorDate(prev => addDays(prev, view === 'week' ? 7 : 1));
  }
  function goToMonth(d) { setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1)); }

  // The mini month-picker steps by month regardless of which main view
  // (Month/Week/Day) is active — a separate concept from the main Prev/
  // Today/Next control, which adapts to the current view.
  function miniPrevMonth() { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)); }
  function miniNextMonth() { setMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)); }
  function selectMiniDay(d) { setCursorDate(toDateOnly(d)); goToMonth(d); }

  async function deleteScheduleEvent(id) {
    if (!confirm('Delete this event?')) return;
    setDeletingEvent(true);
    const { error } = await supabase.from('schedule_events').delete().eq('id', id);
    setDeletingEvent(false);
    if (error) { alert('Failed to delete: ' + error.message); return; }
    setPreviewEvent(null);
    await loadScheduleEvents();
  }

  const today = toDateOnly(new Date());

  // The Sun-Sat week containing cursorDate, for the Week agenda view.
  const cursorWeekStart = addDays(cursorDate, -cursorDate.getDay());
  const cursorWeekDays = Array.from({ length: 7 }, (_, i) => addDays(cursorWeekStart, i));

  function AgendaDay({ date }) {
    const jobsToday = showJobs ? jobsForDay(date) : [];
    const walksToday = showBidWalks ? bidWalksForDay(date) : [];
    const busyToday = showPersonal ? busyForDay(date) : [];
    const eventsToday = showScheduleEvents ? scheduleEventsForDay(date) : [];
    const isEmpty = jobsToday.length === 0 && walksToday.length === 0 && busyToday.length === 0 && eventsToday.length === 0;
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--heading)' }}>
            {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
          {sameDay(date, today) && <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>Today</span>}
        </div>
        {isEmpty && <div className="empty-state">Nothing scheduled.</div>}
        {eventsToday.map(ev => (
          <div key={ev.id} className="job-row" onClick={() => setPreviewEvent(ev)}>
            <div className="job-main">
              <span className="job-number">📌 {formatEventTime(ev.event_time)}</span>
              <span className="job-customer">{ev.description || EVENT_TYPE_LABELS[ev.event_type]}</span>
            </div>
            <span className="badge">{EVENT_TYPE_LABELS[ev.event_type]}</span>
          </div>
        ))}
        {walksToday.map(b => (
          <div key={b.id} className="job-row" style={{ cursor: 'default' }}>
            <div className="job-main">
              <span className="job-number">🔨 {new Date(b.bid_walk_scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="job-customer">Bid walk — {b.contact_name || 'Lead'}</span>
              {b.project && <span className="job-address">{b.project}</span>}
            </div>
          </div>
        ))}
        {jobsToday.map(job => (
          <div key={job.id} className="job-row" onClick={() => router.push(`/jobs/${job.id}`)}>
            <div className="job-main">
              <span className="job-number">{formattedProjectNumber(job)}</span>
              <span className="job-customer">{job.customer_name || 'Unnamed'}</span>
            </div>
            <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
          </div>
        ))}
        {busyToday.map((b, i) => (
          <div key={i} className="job-row" style={{ cursor: 'default', opacity: 0.7 }}>
            <div className="job-main">
              <span className="job-customer">📅 {b.title} (personal)</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Desktop Week/Day view: a real hourly timeline grid (Google Calendar
  // style) instead of the agenda card-list — an all-day row across the
  // top for job bars, then a scrollable hour grid with time-positioned
  // events and a live current-time line on today's column. `days` is the
  // 7 days of the week for Week view, or a single day for Day view.
  function DesktopTimeGrid({ days }) {
    const scrollRef = useRef(null);
    const isSingleDay = days.length === 1;

    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = Math.max(0, topPxForTime(new Date()) - HOUR_HEIGHT * 3);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days[0]?.toDateString()]);

    // All-day bars (job schedules) laid out with the same lane logic used
    // on the Month grid, scoped to just these visible days.
    const rangeStart = days[0];
    const rangeEnd = days[days.length - 1];
    const overlapping = showJobs
      ? jobBars
        .filter(j => j.start <= rangeEnd && j.end >= rangeStart)
        .map(j => {
          const startCol = j.start < rangeStart ? 0 : days.findIndex(d => sameDay(d, j.start));
          const endCol = j.end > rangeEnd ? days.length - 1 : days.findIndex(d => sameDay(d, j.end));
          return { ...j, startCol: startCol === -1 ? 0 : startCol, endCol: endCol === -1 ? days.length - 1 : endCol };
        })
      : [];
    const { placed: allDayBars, laneCount: allDayLanes } = assignLanes(overlapping);

    return (
      <div className="tg">
        <div className="tg-header" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div className="tg-header-corner" />
          {days.map(d => (
            <div
              key={d.toISOString()}
              className={`tg-header-day ${sameDay(d, today) ? 'today' : ''}`}
              onClick={() => { setCursorDate(d); setView('day'); }}
            >
              <span className="tg-header-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span className="tg-header-num">{d.getDate()}</span>
            </div>
          ))}
        </div>

        {(allDayBars.length > 0 || !isSingleDay) && (
          <div
            className="tg-allday"
            style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, minHeight: Math.max(allDayLanes, 1) * 24 + 8 }}
          >
            <div className="tg-allday-label">All day</div>
            <div className="tg-allday-cells" style={{ gridColumn: `2 / ${days.length + 2}`, position: 'relative' }}>
              {allDayBars.map(job => (
                <div
                  key={job.id}
                  className={`tg-allday-bar badge-${job.stage}`}
                  style={{
                    left: `${(job.startCol / days.length) * 100}%`,
                    width: `${((job.endCol - job.startCol + 1) / days.length) * 100}%`,
                    top: job.lane * 22,
                  }}
                  onClick={e => { e.stopPropagation(); isMobile ? setPreviewJob(job) : router.push(`/jobs/${job.id}`); }}
                  title={`${formattedProjectNumber(job)} — ${job.customer_name || 'Unnamed'} (${STAGE_LABELS[job.stage]})`}
                >
                  {formattedProjectNumber(job)} {job.customer_name || ''}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tg-scroll" ref={scrollRef}>
          <div className="tg-grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: HOUR_HEIGHT * 24 }}>
            <div className="tg-hours">
              {HOUR_ROWS.map(h => (
                <div key={h} className="tg-hour-label" style={{ height: HOUR_HEIGHT }}>{h === 0 ? gmtLabel : formatHourLabel(h)}</div>
              ))}
            </div>
            {days.map(d => {
              const walksToday = showBidWalks ? bidWalksForDay(d) : [];
              const eventsToday = showScheduleEvents ? scheduleEventsForDay(d) : [];
              const busyToday = showPersonal ? busyForDay(d) : [];
              const isToday = sameDay(d, today);
              return (
                <div key={d.toISOString()} className="tg-day-col">
                  {HOUR_ROWS.map(h => <div key={h} className="tg-hour-line" style={{ top: h * HOUR_HEIGHT }} />)}

                  {eventsToday.map(ev => (
                    <div
                      key={`ev-${ev.id}`}
                      className="tg-event tg-event-schedule"
                      style={{ top: topPxForTimeStr(ev.event_time), height: 40 }}
                      onClick={() => setPreviewEvent(ev)}
                    >
                      <span className="tg-event-title">📌 {ev.description || EVENT_TYPE_LABELS[ev.event_type]}</span>
                      <span className="tg-event-time">{formatEventTime(ev.event_time)}</span>
                    </div>
                  ))}

                  {walksToday.map(b => (
                    <div
                      key={`bw-${b.id}`}
                      className="tg-event tg-event-bidwalk"
                      style={{ top: topPxForTime(new Date(b.bid_walk_scheduled_at)), height: 40 }}
                    >
                      <span className="tg-event-title">🔨 Bid walk — {b.contact_name || 'Lead'}</span>
                      <span className="tg-event-time">{new Date(b.bid_walk_scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                  ))}

                  {busyToday.map((b, i) => {
                    const start = new Date(b.start_at);
                    const end = new Date(b.end_at);
                    const top = sameDay(start, d) ? topPxForTime(start) : 0;
                    const bottom = sameDay(end, d) ? topPxForTime(end) : HOUR_HEIGHT * 24;
                    return (
                      <div
                        key={`busy-${i}`}
                        className="tg-event tg-event-personal"
                        style={{ top, height: Math.max(bottom - top, 20) }}
                      >
                        <span className="tg-event-title">📅 {b.title} (personal)</span>
                      </div>
                    );
                  })}

                  {isToday && (
                    <div className="tg-now-line" style={{ top: topPxForTime(nowTick) }}>
                      <span className="tg-now-dot" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const viewPicker = (
    <div className="tab-sections-pills" style={{ margin: 0 }}>
      <button type="button" className={`tab-section-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
      <button type="button" className={`tab-section-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
      <button type="button" className={`tab-section-btn ${view === 'day' ? 'active' : ''}`} onClick={() => setView('day')}>Day</button>
    </div>
  );
  // The middle nav button always jumps to today, but its label reflects
  // what "today" means for the active view: the real current month's name
  // on Month view (not the abstract word "Today"), "This Week" on Week
  // view, and "Today" on Day view, where that word is already exact.
  const goTodayLabel = view === 'month'
    ? new Date().toLocaleDateString('en-US', { month: 'long' })
    : view === 'week' ? 'This Week' : 'Today';
  const arrowGroup = (
    <div className="section-actions" style={{ marginTop: 0 }}>
      <button className="btn btn-sm" onClick={goPrev}>←</button>
      <button className="btn btn-sm" onClick={goToday}>{goTodayLabel}</button>
      <button className="btn btn-sm" onClick={goNext}>→</button>
    </div>
  );

  const mainCalendar = (
    <div style={{ minWidth: 0, flex: 1 }}>
      {isMobile ? (
        <>
          <div className="top-actions" style={{ marginBottom: view === 'month' ? 18 : 10 }}>
            <h2 style={{ margin: 0, color: 'var(--heading)' }}>Calendar</h2>
            {view === 'month' && viewPicker}
          </div>
          {view !== 'month' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              {viewPicker}
              {arrowGroup}
            </div>
          )}
        </>
      ) : (
        // Today/prev/next sit right next to the title (as in the Google
        // Calendar reference), and the Month/Week/Day switcher — the
        // equivalent of Google's view dropdown — sits on the far right.
        // "+ New Event" now lives at the top of the sidebar in the Create
        // button's spot, not up here.
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Calendar</h2>
          {arrowGroup}
          <div style={{ marginLeft: 'auto' }}>{viewPicker}</div>
        </div>
      )}

      {isMobile && view === 'month' && (
        <div className="cal-month-chips">
          {monthChips.map(d => (
            <button
              key={d.toISOString()}
              className={`cal-month-chip ${d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth() ? 'active' : ''}`}
              onClick={() => goToMonth(d)}
            >
              {MONTH_ABBR[d.getMonth()]}
            </button>
          ))}
        </div>
      )}

      {view === 'month' && (
      <>
      {/* Desktop drops the month/year heading and the explanatory blurb —
          the nav bar's "September" button and the sidebar mini-calendar's
          own "September 2026" header already say what month this is, and
          the inline per-day event lines now speak for themselves. Mobile,
          which has neither of those, keeps its heading. */}
      {isMobile && (
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--heading)', marginBottom: 4 }}>
          {monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
      )}

      <div className="calendar-grid">
        {DAY_LABELS.map(d => <div key={d} className="calendar-day-label">{d}</div>)}
      </div>

      {weeks.map((week, wi) => {
        const weekStartCol = 0;
        const weekEndCol = 6;
        const weekStart = week[0].date;
        const weekEnd = week[6].date;

        const overlapping = showJobs
          ? jobBars
            .filter(j => j.start <= weekEnd && j.end >= weekStart)
            .map(j => {
              const startCol = j.start < weekStart ? weekStartCol : weekdayIndex(j.start);
              const endCol = j.end > weekEnd ? weekEndCol : weekdayIndex(j.end);
              return { ...j, startCol, endCol };
            })
          : [];
        const { placed, laneCount } = assignLanes(overlapping);

        // Timed items (schedule events, bid walks, synced personal blocks)
        // for each day, sorted by clock time — this is what makes the
        // month grid read like Google's: a small dot + time + title line
        // per event, not a corner badge you have to hover to decode.
        const dayItems = week.map(day => timedItemsForDay(day.date));
        const MAX_VISIBLE = 3;
        const maxLines = Math.max(1, ...dayItems.map(items => Math.min(items.length, MAX_VISIBLE) + (items.length > MAX_VISIBLE ? 1 : 0)));
        // A minimum row height even for an empty week — Google's grid
        // gives every day real room to breathe rather than shrink-wrapping
        // to whatever content happens to be there that week.
        const headerHeight = Math.max(92, 28 + maxLines * 17 + 10);
        // No job bars this week → no reserved lane row at all, so weeks
        // with nothing scheduled don't carry a blank 30px band that reads
        // as padding between rows. Weeks butt right up against each other.
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
                      <div
                        key={item.key}
                        className={`cal-day-event-line ${item.onClick ? 'clickable' : ''}`}
                        title={item.title}
                        onClick={item.onClick ? (e) => { e.stopPropagation(); item.onClick(); } : undefined}
                      >
                        <span className={`cal-day-event-dot ${item.dotClass}`} />
                        {item.time && <span className="cal-day-event-time">{item.time}</span>}
                        <span className="cal-day-event-title">{item.title}</span>
                      </div>
                    ))}
                    {items.length > MAX_VISIBLE && (
                      <div
                        className="cal-day-more"
                        onClick={e => { e.stopPropagation(); setCursorDate(day.date); setView('day'); }}
                      >
                        +{items.length - MAX_VISIBLE} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {placed.map(job => (
              <div
                key={job.id}
                className={`calendar-bar badge-${job.stage}`}
                style={{ gridColumn: `${job.startCol + 1} / ${job.endCol + 2}`, gridRow: job.lane + 2 }}
                onClick={e => { e.stopPropagation(); isMobile ? setPreviewJob(job) : router.push(`/jobs/${job.id}`); }}
                title={`${formattedProjectNumber(job)} — ${job.customer_name || 'Unnamed'} (${STAGE_LABELS[job.stage]})`}
              >
                {isMobile ? (job.customer_name || 'Unnamed') : `${formattedProjectNumber(job)} ${job.customer_name || ''}`}
              </div>
            ))}
          </div>
        );
      })}

      {jobBars.length === 0 && (
        <div className="empty-state" style={{ marginTop: 16 }}>No jobs have a Scheduled Start Date set yet.</div>
      )}
      </>
      )}

      {view === 'week' && (
        isMobile ? (
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
              Week of {cursorWeekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {cursorWeekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            {cursorWeekDays.map(d => <AgendaDay key={d.toISOString()} date={d} />)}
          </div>
        ) : (
          <DesktopTimeGrid days={cursorWeekDays} />
        )
      )}

      {view === 'day' && (
        isMobile ? (
          <div>
            <AgendaDay date={cursorDate} />
          </div>
        ) : (
          <DesktopTimeGrid days={[cursorDate]} />
        )
      )}
    </div>
  );

  return (
    <AppShell>
      <div className="container container-wide">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {!isMobile && (
            <CalendarSidebar
              monthDate={monthDate}
              cursorDate={cursorDate}
              today={today}
              onSelectDay={selectMiniDay}
              onPrevMonth={miniPrevMonth}
              onNextMonth={miniNextMonth}
              onNewEvent={() => setShowNewEvent(true)}
              showJobs={showJobs} setShowJobs={setShowJobs}
              showBidWalks={showBidWalks} setShowBidWalks={setShowBidWalks}
              showScheduleEvents={showScheduleEvents} setShowScheduleEvents={setShowScheduleEvents}
              showPersonal={showPersonal} setShowPersonal={setShowPersonal}
            />
          )}
          {mainCalendar}
        </div>
      </div>

      {isMobile && (
        <MobileFab
          label="New Event"
          items={[{ label: '+ New Event', primary: true, onClick: () => setShowNewEvent(true) }]}
        />
      )}

      <NewEventModal
        open={showNewEvent}
        onClose={() => setShowNewEvent(false)}
        onCreated={loadScheduleEvents}
        defaultDate={cursorDate ? `${cursorDate.getFullYear()}-${String(cursorDate.getMonth() + 1).padStart(2, '0')}-${String(cursorDate.getDate()).padStart(2, '0')}` : undefined}
      />

      <PopupModal open={!!previewEvent} onClose={() => setPreviewEvent(null)} maxWidth={380}>
        {previewEvent && (
          <div>
            <span className="badge">{EVENT_TYPE_LABELS[previewEvent.event_type]}</span>
            <h3 style={{ margin: '8px 0 4px' }}>{previewEvent.description || EVENT_TYPE_LABELS[previewEvent.event_type]}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              {parseDateOnly(previewEvent.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}{formatEventTime(previewEvent.event_time)}
            </div>
            {previewEvent.assigned_staff_ids?.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
                With: {previewEvent.assigned_staff_ids.map(id => staffById[id] || 'Unknown').join(', ')}
              </div>
            )}
            <div className="section-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-sm btn-danger" disabled={deletingEvent} onClick={() => deleteScheduleEvent(previewEvent.id)}>
                {deletingEvent ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </PopupModal>

      <PopupModal open={!!previewJob} onClose={() => setPreviewJob(null)} maxWidth={360}>
        {previewJob && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{formattedProjectNumber(previewJob)}</div>
            <h3 style={{ margin: '4px 0 10px' }}>{previewJob.customer_name || 'Unnamed'}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span className={`badge badge-${previewJob.stage}`}>{STAGE_LABELS[previewJob.stage]}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              {previewJob.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {' – '}
              {previewJob.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <div className="section-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={() => router.push(`/jobs/${previewJob.id}`)}>View job →</button>
            </div>
          </div>
        )}
      </PopupModal>

      <style jsx global>{`
        .cal-month-chips{
          display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch;
          scrollbar-width: none; padding-bottom: 4px; margin-bottom: 14px;
        }
        .cal-month-chips::-webkit-scrollbar{ display: none; }
        .cal-month-chip{
          flex-shrink: 0; padding: 7px 16px; border-radius: 20px; border: 1px solid var(--line);
          background: var(--card-bg); color: var(--ink-soft); font-size: 13px; font-weight: 600;
          cursor: pointer;
        }
        .cal-month-chip.active{ background: var(--accent); border-color: var(--accent); color: #fff; }

        .calendar-day-selected{ box-shadow: inset 0 0 0 2px var(--accent); }

        /* --- Sidebar: Create button, mini month-picker, filter/legend --- */
        .cal-sidebar{ width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 18px; }
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
        .cal-sidebar-toggle{ display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink); cursor: pointer; line-height: 1.3; }
        /* The global input{width:100%} rule otherwise stretches the
           checkbox to fill the flex row, shoving its label off to the far
           right — pin it back to its natural checkbox size. */
        .cal-sidebar-toggle input{ margin: 0; width: 14px; height: 14px; flex: 0 0 auto; }
        .cal-legend-item{ display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink); }
        .cal-legend-dot{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

        @media (max-width: 900px){
          .cal-sidebar{ display: none; }
        }

        /* --- Desktop Week/Day hourly timeline grid --- */
        .tg{ border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card-bg); }
        .tg-header{ display: grid; border-bottom: 1px solid var(--line); }
        .tg-header-corner{ border-right: 1px solid transparent; }
        .tg-header-day{
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 8px 0; cursor: pointer; border-left: 1px solid var(--line);
        }
        .tg-header-day:hover{ background: var(--panel); }
        .tg-header-dow{ font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
        .tg-header-num{ font-size: 16px; font-weight: 700; color: var(--heading); margin-top: 2px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .tg-header-day.today .tg-header-num{ background: var(--accent); color: #fff; }

        .tg-allday{ display: grid; border-bottom: 1px solid var(--line); position: relative; padding: 4px 0; }
        .tg-allday-label{ font-size: 9.5px; color: var(--ink-soft); display: flex; align-items: center; justify-content: center; }
        .tg-allday-cells{ min-height: 20px; }
        .tg-allday-bar{
          position: absolute; height: 20px; border-radius: 4px; font-size: 10.5px; font-weight: 600;
          color: #fff; padding: 2px 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
          cursor: pointer; margin: 0 2px;
        }

        /* Scrolls, but stays invisible — a visible scrollbar here eats into
           this element's width without eating into .tg-header's (a
           separate sibling above it), so the day columns below drift out
           of alignment with the day columns in the header. Hiding the
           scrollbar keeps both the same width and looks cleaner besides. */
        .tg-scroll{ max-height: 620px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
        .tg-scroll::-webkit-scrollbar{ width: 0; height: 0; display: none; }
        .tg-grid{ display: grid; position: relative; }
        .tg-hours{ position: relative; border-right: 1px solid var(--line); }
        .tg-hour-label{ font-size: 10px; color: var(--ink-soft); text-align: right; padding-right: 8px; transform: translateY(-6px); }
        .tg-day-col{ position: relative; border-left: 1px solid var(--line); }
        .tg-hour-line{ position: absolute; left: 0; right: 0; border-top: 1px solid var(--line); opacity: 0.6; }

        .tg-event{
          position: absolute; left: 3px; right: 3px; border-radius: 5px; padding: 3px 6px;
          font-size: 10.5px; overflow: hidden; cursor: default; display: flex; flex-direction: column;
          line-height: 1.25; border-left: 3px solid var(--accent); background: var(--panel);
        }
        .tg-event-title{ font-weight: 600; color: var(--heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tg-event-time{ color: var(--ink-soft); font-size: 9.5px; }
        .tg-event-schedule{ cursor: pointer; border-left-color: var(--accent); }
        .tg-event-bidwalk{ border-left-color: #b8860b; }
        .tg-event-personal{ border-left-color: var(--ink-soft); opacity: 0.75; }

        .tg-now-line{ position: absolute; left: 0; right: 0; border-top: 2px solid #e0453c; z-index: 2; }
        .tg-now-dot{ position: absolute; left: -4px; top: -5px; width: 9px; height: 9px; border-radius: 50%; background: #e0453c; }
      `}</style>
    </AppShell>
  );
}
