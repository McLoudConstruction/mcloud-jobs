'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { DEFAULT_TZ, slotLabel } from '../lib/consultSlots';

// Settings > Consultations (owner only).
//
// Controls what the website chat assistant may offer a visitor:
//   • whether it can book consultations at all
//   • the weekly hours, how long a consultation is, the buffer between them,
//     how much notice it needs, how far ahead it offers, and the most per day
//   • blackout periods (vacations, holidays, a morning you are busy)
// and shows the consultations it has booked and the recent chats, so you can
// see what visitors ask and where it needs help.
//
// Everything reads and writes the tables from migration 181 under the admin
// row level security policies, so this screen being hidden from other roles is
// a convenience, not the protection.

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const muted = { fontSize: 12, color: 'var(--ink-soft)' };

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function prettyTime(value) {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function blackoutText(b) {
  const range = b.start_date === b.end_date ? prettyDate(b.start_date) : `${prettyDate(b.start_date)} to ${prettyDate(b.end_date)}`;
  return b.start_time && b.end_time ? `${range}, ${prettyTime(b.start_time)} to ${prettyTime(b.end_time)}` : `${range}, all day`;
}

export default function ConsultAvailabilityPanel() {
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [blackouts, setBlackouts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [chats, setChats] = useState([]);
  const [openChat, setOpenChat] = useState(null); // { id, messages }
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  const [bStart, setBStart] = useState('');
  const [bEnd, setBEnd] = useState('');
  const [bPartial, setBPartial] = useState(false);
  const [bFrom, setBFrom] = useState('09:00');
  const [bTo, setBTo] = useState('12:00');
  const [bReason, setBReason] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [settingsRes, appRes] = await Promise.all([
      supabase.from('consult_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('app_settings').select('timezone').eq('id', 1).maybeSingle(),
    ]);
    if (settingsRes.error) {
      setError(`${settingsRes.error.message}. Make sure migration 181 has been run in Supabase.`);
      return;
    }
    const zone = appRes.data?.timezone || DEFAULT_TZ;
    setTz(zone);
    const row = settingsRes.data;
    setSaved(row);
    setForm(row ? { ...row, weekly_hours: { ...row.weekly_hours } } : null);

    const today = todayIn(zone);
    const [bo, bk, ch] = await Promise.all([
      supabase.from('consult_blackouts').select('*').gte('end_date', today).order('start_date'),
      supabase
        .from('consult_bookings')
        .select('id, starts_at, status, opportunity_id, opportunities(contact_name, contact_phone, contact_email, address, project)')
        .eq('status', 'booked')
        .gte('starts_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString())
        .order('starts_at'),
      supabase
        .from('chat_conversations')
        .select('id, started_at, last_message_at, user_message_count, escalated, escalation_reason, page_path, opportunity_id')
        .order('last_message_at', { ascending: false })
        .limit(25),
    ]);
    setBlackouts(bo.data || []);
    setBookings(bk.data || []);
    setChats(ch.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => form && saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function setWindows(dayKey, windows) {
    setForm(prev => ({ ...prev, weekly_hours: { ...prev.weekly_hours, [dayKey]: windows } }));
  }

  function toast(message) {
    setFlash(message);
    setTimeout(() => setFlash(''), 2500);
  }

  async function save() {
    setError('');
    // Drop windows that end before they start, then clamp the numbers to the
    // same limits the database enforces.
    const weekly = {};
    for (const d of DAYS) {
      weekly[d.key] = (form.weekly_hours[d.key] || []).filter(w => w.start && w.end && w.end > w.start);
    }
    const patch = {
      enabled: !!form.enabled,
      slot_minutes: clampInt(form.slot_minutes, 15, 480, 60),
      buffer_minutes: clampInt(form.buffer_minutes, 0, 240, 30),
      min_notice_hours: clampInt(form.min_notice_hours, 0, 720, 24),
      max_days_ahead: clampInt(form.max_days_ahead, 1, 120, 30),
      max_per_day: clampInt(form.max_per_day, 1, 20, 3),
      weekly_hours: weekly,
      updated_at: new Date().toISOString(),
    };
    setBusy(true);
    const { error: saveError } = await supabase.from('consult_settings').update(patch).eq('id', 1);
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    toast('Saved');
    load();
  }

  async function addBlackout() {
    setError('');
    if (!bStart) { setError('Choose the first day.'); return; }
    const end = bEnd || bStart;
    if (end < bStart) { setError('The last day cannot be before the first day.'); return; }
    if (bPartial && bTo <= bFrom) { setError('The end time has to be after the start time.'); return; }
    setBusy(true);
    const { error: insertError } = await supabase.from('consult_blackouts').insert({
      start_date: bStart,
      end_date: end,
      start_time: bPartial ? bFrom : null,
      end_time: bPartial ? bTo : null,
      reason: bReason.trim() || null,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    setBStart(''); setBEnd(''); setBPartial(false); setBReason('');
    toast('Blackout added');
    load();
  }

  async function removeBlackout(id) {
    const { error: delError } = await supabase.from('consult_blackouts').delete().eq('id', id);
    if (delError) { setError(delError.message); return; }
    load();
  }

  async function cancelBooking(b) {
    if (!window.confirm('Cancel this consultation? The time opens up again. Let the customer know yourself.')) return;
    const { error: cancelError } = await supabase.from('consult_bookings').update({ status: 'canceled' }).eq('id', b.id);
    if (cancelError) { setError(cancelError.message); return; }
    if (b.opportunity_id) {
      await supabase
        .from('opportunities')
        .update({ bid_walk_scheduled_at: null })
        .eq('id', b.opportunity_id)
        .eq('bid_walk_scheduled_at', b.starts_at);
    }
    toast('Consultation canceled');
    load();
  }

  async function toggleChat(id) {
    if (openChat?.id === id) { setOpenChat(null); return; }
    const { data } = await supabase.from('chat_conversations').select('messages').eq('id', id).maybeSingle();
    setOpenChat({ id, messages: data?.messages || [] });
  }

  if (error && !form) return <div className="error-text" style={{ marginTop: 16 }}>{error}</div>;
  if (!form) return <div style={{ ...muted, marginTop: 16 }}>Loading…</div>;

  return (
    <div style={{ marginTop: 16 }}>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ── Booking rules ─────────────────────────────────────────── */}
      <div className="card">
        <h3>Website consultation booking</h3>
        <div style={{ ...muted, maxWidth: 640, marginBottom: 12 }}>
          Controls when the chat assistant on mcloudconstruction.com can book a free consultation for a visitor.
          Times are in {tz.replace('_', ' ')}. Each booking creates a lead with the consultation set as its bid walk, so it
          shows on your calendar. Anything already on your calendar or booked as a bid walk is never offered again.
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!form.enabled} onChange={e => setField('enabled', e.target.checked)} />
          Let the chat assistant book consultations
        </label>
        <div style={{ ...muted, margin: '4px 0 14px 24px' }}>
          When this is off, the assistant still answers questions and can take a visitor&apos;s details for a callback.
        </div>

        <div style={{ fontWeight: 600, marginBottom: 6 }}>Weekly hours</div>
        <div style={{ ...muted, marginBottom: 8 }}>The windows when a consultation may start and finish. Leave a day without hours to keep it closed.</div>
        {DAYS.map(d => {
          const windows = form.weekly_hours[d.key] || [];
          return (
            <div key={d.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ width: 96, fontWeight: 500 }}>{d.label}</div>
              {windows.length === 0 && <span style={muted}>Closed</span>}
              {windows.map((w, i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input aria-label={`${d.label} window ${i + 1} start`} type="time" style={{ width: 'auto' }} value={w.start} onChange={e => setWindows(d.key, windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                  <span style={muted}>to</span>
                  <input aria-label={`${d.label} window ${i + 1} end`} type="time" style={{ width: 'auto' }} value={w.end} onChange={e => setWindows(d.key, windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                  <button type="button" className="btn btn-sm" onClick={() => setWindows(d.key, windows.filter((_, j) => j !== i))} aria-label={`Remove ${d.label} window`}>Remove</button>
                </span>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => setWindows(d.key, [...windows, { start: windows.length ? '13:00' : '09:00', end: windows.length ? '16:00' : '16:00' }])}>
                {windows.length ? 'Add another window' : 'Open this day'}
              </button>
            </div>
          );
        })}

        <div className="two-col" style={{ marginTop: 16 }}>
          <div>
            <label htmlFor="cc-slot">Consultation length (minutes)</label>
            <input id="cc-slot" type="number" min="15" max="480" step="15" value={form.slot_minutes} onChange={e => setField('slot_minutes', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cc-buffer">Buffer between consultations (minutes)</label>
            <input id="cc-buffer" type="number" min="0" max="240" step="5" value={form.buffer_minutes} onChange={e => setField('buffer_minutes', e.target.value)} />
          </div>
        </div>
        <div className="two-col-3" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="cc-notice">Minimum notice (hours)</label>
            <input id="cc-notice" type="number" min="0" max="720" value={form.min_notice_hours} onChange={e => setField('min_notice_hours', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cc-ahead">Offer up to this many days ahead</label>
            <input id="cc-ahead" type="number" min="1" max="120" value={form.max_days_ahead} onChange={e => setField('max_days_ahead', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cc-perday">Most consultations per day</label>
            <input id="cc-perday" type="number" min="1" max="20" value={form.max_per_day} onChange={e => setField('max_per_day', e.target.value)} />
          </div>
        </div>

        <div className="section-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
          {flash && <span style={{ fontSize: 12, color: '#3a6b45', marginLeft: 10 }}>{flash}</span>}
          {dirty && !flash && <span style={{ ...muted, marginLeft: 10 }}>Unsaved changes</span>}
        </div>
      </div>

      {/* ── Blackouts ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Blackout periods</h3>
        <div style={{ ...muted, maxWidth: 640, marginBottom: 12 }}>
          Days or times the assistant will never offer, such as a vacation, a holiday, or a morning you are tied up.
          Bookings already made are not canceled; cancel those below.
        </div>

        {blackouts.length === 0 && <div style={{ ...muted, marginBottom: 12 }}>No upcoming blackout periods.</div>}
        {blackouts.map(b => (
          <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontWeight: 500 }}>{blackoutText(b)}</div>
              {b.reason && <div style={muted}>{b.reason}</div>}
            </div>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => removeBlackout(b.id)}>Remove</button>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Add a blackout</div>
          <div className="two-col">
            <div>
              <label htmlFor="cc-bstart">First day</label>
              <input id="cc-bstart" type="date" value={bStart} onChange={e => { setBStart(e.target.value); if (!bEnd || bEnd < e.target.value) setBEnd(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="cc-bend">Last day</label>
              <input id="cc-bend" type="date" value={bEnd} min={bStart || undefined} onChange={e => setBEnd(e.target.value)} />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, cursor: 'pointer', margin: '10px 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={bPartial} onChange={e => setBPartial(e.target.checked)} />
            Only part of the day
          </label>
          {bPartial && (
            <div className="two-col" style={{ marginBottom: 10 }}>
              <div>
                <label htmlFor="cc-bfrom">From</label>
                <input id="cc-bfrom" type="time" value={bFrom} onChange={e => setBFrom(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cc-bto">To</label>
                <input id="cc-bto" type="time" value={bTo} onChange={e => setBTo(e.target.value)} />
              </div>
            </div>
          )}
          <label htmlFor="cc-breason">Note (optional, only you see this)</label>
          <input id="cc-breason" value={bReason} maxLength={120} placeholder="Family trip, holiday, site visit" onChange={e => setBReason(e.target.value)} />
          <div className="section-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={addBlackout} disabled={busy || !bStart}>Add blackout</button>
          </div>
        </div>
      </div>

      {/* ── Booked consultations ─────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Consultations booked by the chat</h3>
        {bookings.length === 0 && <div style={muted}>None upcoming.</div>}
        {bookings.map(b => {
          const o = b.opportunities || {};
          return (
            <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{slotLabel(new Date(b.starts_at), tz)}</div>
                <div>{o.contact_name || 'Unknown'}{o.project ? `, ${o.project}` : ''}</div>
                <div style={muted}>
                  {[o.address, o.contact_phone, o.contact_email].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => cancelBooking(b)}>Cancel</button>
            </div>
          );
        })}
      </div>

      {/* ── Recent chats ──────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent chats</h3>
        <div style={{ ...muted, maxWidth: 640, marginBottom: 10 }}>
          The last 25 conversations. Read a few each week: the questions it could not answer are what to add to its knowledge.
        </div>
        {chats.length === 0 && <div style={muted}>No chats yet.</div>}
        {chats.map(c => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
            <button
              type="button"
              onClick={() => toggleChat(c.id)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, width: '100%', justifyContent: 'space-between', alignItems: 'center' }}
              aria-expanded={openChat?.id === c.id}
            >
              <span>
                {new Date(c.last_message_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })}
                <span style={{ ...muted, marginLeft: 8 }}>
                  {c.user_message_count} message{c.user_message_count === 1 ? '' : 's'}{c.page_path ? ` · ${c.page_path}` : ''}
                </span>
              </span>
              <span style={{ display: 'inline-flex', gap: 6 }}>
                {c.opportunity_id && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(58,107,69,0.15)', color: '#3a6b45' }}>Lead</span>}
                {c.escalated && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(155,119,61,0.15)', color: 'var(--accent)' }}>Needs a person</span>}
              </span>
            </button>
            {c.escalated && c.escalation_reason && <div style={{ ...muted, marginTop: 2 }}>{c.escalation_reason}</div>}
            {openChat?.id === c.id && (
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {openChat.messages.map((m, i) => (
                  <div key={i} style={{ fontSize: 13, whiteSpace: 'pre-wrap', padding: '6px 10px', borderRadius: 6, background: m.role === 'user' ? 'rgba(0,0,0,0.05)' : 'transparent', border: m.role === 'user' ? 'none' : '1px solid var(--line)' }}>
                    <strong>{m.role === 'user' ? 'Visitor' : 'Assistant'}:</strong> {m.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
