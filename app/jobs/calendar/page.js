'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import PopupModal from '../../../components/PopupModal';
import MobileFab from '../../../components/MobileFab';
import NewEventModal from '../../../components/NewEventModal';
import { STAGE_LABELS, EVENT_TYPE_LABELS, formattedProjectNumber } from '../../../lib/constants';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
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
    const rangeEnd = addDays(weeks[weeks.length - 1][4].date, 1);
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

  const jobBars = useMemo(() => jobs.map(j => {
    const start = parseDateOnly(j.scheduled_start_date);
    const end = j.scheduled_end_date ? parseDateOnly(j.scheduled_end_date) : start;
    return { ...j, start, end: end < start ? start : end };
  }).filter(j => j.start), [jobs]);

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

  // The Mon-Fri week containing cursorDate, for the Week agenda view.
  const cursorWeekStart = addDays(cursorDate, cursorDate.getDay() === 0 ? -6 : 1 - cursorDate.getDay());
  const cursorWeekDays = Array.from({ length: 5 }, (_, i) => addDays(cursorWeekStart, i));

  // Mobile month navigation: a horizontally scrollable strip of month
  // chips (like a Google Calendar month/year switcher) in place of the
  // prev/Today/next arrows — 3 months back through 8 months ahead of the
  // real current month, regardless of which month is currently shown.
  const monthChips = useMemo(() => {
    const t = new Date();
    const base = new Date(t.getFullYear(), t.getMonth(), 1);
    return Array.from({ length: 12 }, (_, i) => new Date(base.getFullYear(), base.getMonth() - 3 + i, 1));
  }, []);

  function AgendaDay({ date }) {
    const jobsToday = jobsForDay(date);
    const walksToday = bidWalksForDay(date);
    const busyToday = busyForDay(date);
    const eventsToday = scheduleEventsForDay(date);
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

  const viewPicker = (
    <div className="tab-sections-pills" style={{ margin: 0 }}>
      <button type="button" className={`tab-section-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
      <button type="button" className={`tab-section-btn ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
      <button type="button" className={`tab-section-btn ${view === 'day' ? 'active' : ''}`} onClick={() => setView('day')}>Day</button>
    </div>
  );
  const arrowGroup = (
    <div className="section-actions" style={{ marginTop: 0 }}>
      <button className="btn btn-sm" onClick={goPrev}>←</button>
      <button className="btn btn-sm" onClick={goToday}>Today</button>
      <button className="btn btn-sm" onClick={goNext}>→</button>
    </div>
  );

  return (
    <AppShell>
      <div className="container container-wide">
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
          <div className="top-actions">
            <h2 style={{ margin: 0, color: 'var(--heading)' }}>Calendar</h2>
            {viewPicker}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewEvent(true)}>+ New Event</button>
              {arrowGroup}
            </div>
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
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--heading)', marginBottom: 4 }}>
          {monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        {!isMobile && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
            Bars run from a job's Scheduled Start Date to its Scheduled End Date — set both on a job's Project tab. 🔨 marks a scheduled bid walk. Click any bar to open that job.
          </div>
        )}

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
                  style={{ gridColumn: di + 1, gridRow: `1 / ${laneCount + 2}`, position: 'relative' }}
                >
                  <span className="calendar-day-number">{day.date.getDate()}</span>
                  <span style={{ position: 'absolute', top: 4, right: 6, display: 'flex', gap: 4 }}>
                    {scheduleEventsForDay(day.date).length > 0 && (
                      <span
                        title={scheduleEventsForDay(day.date).map(ev => `${EVENT_TYPE_LABELS[ev.event_type]} — ${ev.description || 'No description'}`).join(', ')}
                        style={{ fontSize: 9.5, color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 5px' }}
                      >
                        📌 {scheduleEventsForDay(day.date).length}
                      </span>
                    )}
                    {bidWalksForDay(day.date).length > 0 && (
                      <span
                        title={bidWalksForDay(day.date).map(b => `Bid walk — ${b.contact_name || 'Lead'}`).join(', ')}
                        style={{ fontSize: 9.5, color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 5px' }}
                      >
                        🔨 {bidWalksForDay(day.date).length}
                      </span>
                    )}
                    {busyForDay(day.date).length > 0 && (
                      <span
                        title={busyForDay(day.date).map(b => b.title).join(', ')}
                        style={{ fontSize: 9.5, color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 5px' }}
                      >
                        {busyForDay(day.date).length} personal
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {placed.map(job => (
                <div
                  key={job.id}
                  className={`calendar-bar badge-${job.stage}`}
                  style={{ gridColumn: `${job.startCol + 1} / ${job.endCol + 2}`, gridRow: job.lane + 2 }}
                  onClick={() => (isMobile ? setPreviewJob(job) : router.push(`/jobs/${job.id}`))}
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
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
              Week of {cursorWeekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {cursorWeekDays[4].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            {cursorWeekDays.map(d => <AgendaDay key={d.toISOString()} date={d} />)}
          </div>
        )}

        {view === 'day' && (
          <div>
            <AgendaDay date={cursorDate} />
          </div>
        )}
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

      <style jsx>{`
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
      `}</style>
    </AppShell>
  );
}
