'use client';
import { useEffect, useRef, useState } from 'react';
import PopupModal from './PopupModal';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// 15-minute increments rather than Apple's every-minute wheel — a bid
// walk doesn't need minute-level precision, and it keeps the wheel short
// enough to reach any value in a swipe or two.
const MINUTES = [0, 15, 30, 45];
const MERIDIEMS = ['AM', 'PM'];

const ITEM_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const WHEEL_PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

function pad2(n) { return String(n).padStart(2, '0'); }
function isSameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfDay(d) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }

// One column of a wheel picker (hour / minute / AM-PM) — a plain scrollable
// list with CSS scroll-snap doing the actual snapping; this just tracks
// scroll position to (a) fade items by distance from center, the way
// Apple's alarm picker does, and (b) commit the centered value once the
// user stops scrolling.
function WheelColumn({ options, labels, value, onChange }) {
  const ref = useRef(null);
  const settleTimer = useRef(null);
  const selectedIndex = Math.max(0, options.indexOf(value));
  const [rawOffset, setRawOffset] = useState(selectedIndex);

  // Position the wheel on mount (and only on mount — this component is
  // remounted fresh each time the time step is shown, since the calendar
  // step unmounts it entirely, so "on open" and "on mount" are the same
  // moment here).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = selectedIndex * ITEM_HEIGHT;
    setRawOffset(selectedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    setRawOffset(el.scrollTop / ITEM_HEIGHT);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const idx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
      if (options[idx] !== value) onChange(options[idx]);
      el.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
      setRawOffset(idx);
    }, 110);
  }

  function selectIndex(i) {
    onChange(options[i]);
    ref.current?.scrollTo({ top: i * ITEM_HEIGHT, behavior: 'smooth' });
  }

  return (
    <div className="dt-wheel" ref={ref} onScroll={handleScroll}>
      <div style={{ height: WHEEL_PAD, flexShrink: 0 }} />
      {options.map((opt, i) => {
        const dist = Math.abs(i - rawOffset);
        return (
          <div
            key={opt}
            className={`dt-wheel-item ${i === selectedIndex ? 'selected' : ''}`}
            style={{ opacity: Math.max(0.28, 1 - dist * 0.32) }}
            onClick={() => selectIndex(i)}
          >
            {labels ? labels[i] : opt}
          </div>
        );
      })}
      <div style={{ height: WHEEL_PAD, flexShrink: 0 }} />
    </div>
  );
}

// Two-step "Schedule Bid Walk" picker: a calendar to pick the date (styled
// after a Material date picker), then an Apple-alarm-style wheel to pick
// the time — replacing the old bare <input type="datetime-local"> with
// something that actually fits the rest of the mobile redesign. Returns
// the same "YYYY-MM-DDTHH:mm" local-time string a datetime-local input
// would have, so the caller's existing `new Date(value).toISOString()`
// handling doesn't need to change.
export default function BidWalkScheduler({ open, onCancel, onConfirm }) {
  const today = startOfDay(new Date());
  const [step, setStep] = useState('date');
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [meridiem, setMeridiem] = useState('AM');

  // Fresh state every time the picker is opened, rather than resuming
  // wherever the last attempt left off.
  useEffect(() => {
    if (!open) return;
    const now = startOfDay(new Date());
    setStep('date');
    setSelectedDate(now);
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setHour(9);
    setMinute(0);
    setMeridiem('AM');
  }, [open]);

  if (!open) return null;

  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  function changeMonth(delta) {
    setViewMonth(v => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  function handleConfirm() {
    let h24 = hour % 12;
    if (meridiem === 'PM') h24 += 12;
    const y = selectedDate.getFullYear();
    const m = pad2(selectedDate.getMonth() + 1);
    const d = pad2(selectedDate.getDate());
    onConfirm(`${y}-${m}-${d}T${pad2(h24)}:${pad2(minute)}`);
  }

  return (
    <PopupModal open={open} onClose={onCancel} maxWidth={340}>
      {step === 'date' ? (
        <div className="dt-picker">
          <div className="dt-picker-title">Select bid walk date</div>
          <div className="dt-picker-banner">
            <div className="dt-picker-banner-year">{selectedDate.getFullYear()}</div>
            <div className="dt-picker-banner-day">{selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          </div>
          <div className="dt-picker-monthnav">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
            <span>{viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className="dt-picker-weekdays">
            {WEEKDAY_INITIALS.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="dt-picker-days">
            {cells.map((cell, i) => cell ? (
              <button
                type="button"
                key={i}
                className={`dt-picker-day ${isSameDay(cell, selectedDate) ? 'selected' : ''} ${isSameDay(cell, today) ? 'today' : ''}`}
                onClick={() => { setSelectedDate(cell); setStep('time'); }}
              >
                {cell.getDate()}
              </button>
            ) : <span key={i} />)}
          </div>
        </div>
      ) : (
        <div className="dt-picker">
          <div className="dt-picker-title">Select bid walk time</div>
          <div className="dt-picker-subtitle">
            <span>{selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
            <button type="button" className="dt-picker-changedate" onClick={() => setStep('date')}>Change date</button>
          </div>
          <div className="dt-picker-wheels">
            <div className="dt-picker-wheel-highlight" aria-hidden="true" />
            <WheelColumn options={HOURS} value={hour} onChange={setHour} />
            <WheelColumn options={MINUTES} labels={MINUTES.map(pad2)} value={minute} onChange={setMinute} />
            <WheelColumn options={MERIDIEMS} value={meridiem} onChange={setMeridiem} />
          </div>
          <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} onClick={handleConfirm}>
            Confirm bid walk time
          </button>
        </div>
      )}
    </PopupModal>
  );
}
