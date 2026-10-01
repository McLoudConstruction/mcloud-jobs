'use client';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MapboxPlaceSearch from './MapboxPlaceSearch';
import { supabase } from '../lib/supabaseClient';
import { buildStop } from '../lib/mapRouteHelpers';
import { getCurrentLocation, haversineMiles } from '../lib/salesRoutes';
import {
  TODO_PRESETS, createTodo, todayKey, addDaysKey, nextMondayKey, formatDueDate, formatDueTime,
} from '../lib/salesTodos';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const NEARBY_LIMIT = 5;
const RECENT_CONTACT_MS = 30 * 60 * 1000; // a contact added in the last 30 minutes counts as "just added"

// Drive Mode quick actions for the stop you are at (or the route as a whole):
//   + Add Stop   search a saved property or any place, or pick one near you;
//                it slots into the route where it adds the least driving
//   + To-Do      a checklist item for a chosen day, with an optional time
//                (Send COI, Send Intro Email, Inspection at 9:00); it shows
//                on the Dashboard and the Calendar
export default function DriveModeQuickActions({ stop, stops, staffId, routeId, properties, onQuickAdd }) {
  const [open, setOpen] = useState(null); // null | 'stop' | 'todo'
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(todayKey());
  const [dueTime, setDueTime] = useState('');
  const [linkStop, setLinkStop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [lookedUp, setLookedUp] = useState(false); // location lookup finished (found or not)
  const [locating, setLocating] = useState(false);
  const [position, setPosition] = useState(null);
  const [propContacts, setPropContacts] = useState([]); // this stop's contacts, newest first
  const [contactId, setContactId] = useState('');
  // Always call the latest onQuickAdd, even from search results built earlier.
  const quickAddRef = useRef(onQuickAdd);
  quickAddRef.current = onQuickAdd;

  const propertyId = stop?.property_id || null;
  const openRef = useRef(open);
  openRef.current = open;

  // Load the stop's contacts. preselect: true picks the newest one when it
  // was added moments ago, so "add contact, then add the To-Do" links it
  // without an extra tap. A tap on the chip unlinks it.
  const loadContacts = useCallback(async ({ preselect = false, forceId = null } = {}) => {
    if (!propertyId) { setPropContacts([]); return; }
    const { data, error: err } = await supabase.from('contacts')
      .select('id, name, position, contact_email, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(6);
    if (err) { setPropContacts([]); return; }
    const list = data || [];
    setPropContacts(list);
    if (forceId && list.some(c => c.id === forceId)) setContactId(forceId);
    else if (preselect && list[0] && Date.now() - new Date(list[0].created_at).getTime() < RECENT_CONTACT_MS) setContactId(list[0].id);
  }, [propertyId]);

  // A contact saved from the property panel below shows up here at once.
  useEffect(() => {
    function onSaved(e) {
      if (e.detail?.propertyId !== propertyId) return;
      loadContacts({ forceId: e.detail.contactId });
    }
    window.addEventListener('mcloud:contact-saved', onSaved);
    return () => window.removeEventListener('mcloud:contact-saved', onSaved);
  }, [propertyId, loadContacts]);

  function toggle(which) {
    setMsg('');
    setError('');
    if (open === which) { setOpen(null); return; }
    setTitle('');
    setNote('');
    setDueTime('');
    setLinkStop(true);
    setDueDate(todayKey());
    setContactId('');
    setPropContacts([]);
    if (which === 'todo') loadContacts({ preselect: true });
    setOpen(which);
  }

  // Properties already on the route (not skipped), so they are not offered twice.
  const onRouteIds = useMemo(
    () => new Set((stops || []).filter(s => !s.skipped_at).map(s => s.property_id).filter(Boolean)),
    [stops]
  );

  // Look up where you are once when the Add Stop panel opens, for the "near
  // you" shortcuts. Denied or unavailable just means no shortcuts.
  useEffect(() => {
    if (open !== 'stop' || lookedUp || locating) return undefined;
    setLocating(true);
    getCurrentLocation().then(loc => {
      setPosition(loc);
      setLookedUp(true);
      setLocating(false);
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nearbyList = useMemo(() => {
    if (!position) return [];
    return (properties || [])
      .filter(p => !onRouteIds.has(p.id))
      .map(p => ({ p, d: haversineMiles(position, { lat: Number(p.property_lat), lng: Number(p.property_lng) }) }))
      .filter(x => x.d != null)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEARBY_LIMIT);
  }, [position, properties, onRouteIds]);

  const localMatches = useCallback((q) => {
    const rows = [];
    for (const p of properties || []) {
      const hay = `${p.property_name || ''} ${p.management_company || ''} ${p.property_street || ''} ${p.property_city || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      const name = (p.property_name || '').toLowerCase();
      rows.push({ p, rank: name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2 });
    }
    rows.sort((a, b) => a.rank - b.rank || (a.p.property_name || '').localeCompare(b.p.property_name || ''));
    return rows.slice(0, 6).map(({ p }) => ({
      key: `m-${p.id}`,
      label: p.property_name || 'Unnamed property',
      sub: [p.property_type, p.management_company, p.property_city].filter(Boolean).join(' · '),
      pick: () => addStopNow(buildStop({ property: p })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  async function addStopNow(newStop) {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const result = await quickAddRef.current(newStop);
      if (result && (result.status === 'error' || result.status === 'limit')) setError(result.message);
      else setMsg(result?.message || 'Stop added.');
    } catch (err) {
      setError(err.message || 'Could not add that stop.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      await createTodo({
        staffId,
        title,
        note,
        dueDate,
        dueTime,
        property: linkStop && stop ? stop : null,
        routeId,
        contactId: linkStop ? contactId : null,
      });
      setMsg(`To-Do added for ${formatDueDate(dueDate).toLowerCase()}${dueTime ? ` at ${formatDueTime(dueTime)}` : ''}. It shows on your Dashboard and Calendar.`);
      setOpen(null);
      setTitle('');
      setNote('');
      setContactId('');
    } catch (err) {
      setError(err.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrapStyle}>
      <style>{`
        .dm-search input { width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.28); color: #f3ede0; border-radius: 8px; padding: 10px 12px; font-size: 16px; font-family: inherit; }
        .dm-search input::placeholder { color: rgba(255,255,255,0.45); }
        .dm-search { --card-bg: #2a2620; --panel-line: rgba(255,255,255,0.25); --line: rgba(255,255,255,0.12); --ink-soft: rgba(255,255,255,0.6); color: #f3ede0; text-align: left; }
        .dm-date { color-scheme: dark; }
      `}</style>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={{ ...tabBtn, ...(open === 'stop' ? tabBtnOn : null) }} onClick={() => toggle('stop')}>+ Add Stop</button>
        <button type="button" style={{ ...tabBtn, ...(open === 'todo' ? tabBtnOn : null) }} onClick={() => toggle('todo')}>+ To-Do</button>
      </div>

      {open === 'stop' && (
        <div style={panelStyle}>
          <div className="dm-search">
            <MapboxPlaceSearch
              token={TOKEN || ''}
              placeholder="Search a saved property or any place"
              proximity={position}
              clearOnPick
              localMatches={localMatches}
              onPickPlace={p => addStopNow(buildStop({
                name: p.name, street: p.street, city: p.city, state: p.state, zip: p.zip, lat: p.lat, lng: p.lng,
              }))}
            />
          </div>
          {locating && <div style={hintStyle}>Finding properties near you…</div>}
          {!locating && nearbyList.length > 0 && (
            <div style={{ textAlign: 'left' }}>
              <div style={{ ...hintStyle, marginBottom: 4 }}>Near you</div>
              {nearbyList.map(({ p, d }) => (
                <div key={p.id} style={nearRowStyle}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property_name}</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)' }}>
                      {d < 10 ? d.toFixed(1) : Math.round(d)} mi away{p.management_company ? ` · ${p.management_company}` : ''}
                    </div>
                  </div>
                  <button type="button" style={addBtn} disabled={busy} onClick={() => addStopNow(buildStop({ property: p }))}>Add</button>
                </div>
              ))}
            </div>
          )}
          {!locating && position === null && lookedUp && (
            <div style={hintStyle}>Turn on location to see properties near you.</div>
          )}
        </div>
      )}

      {open === 'todo' && (
        <div style={panelStyle}>
          <div style={chipRowStyle}>
            {TODO_PRESETS.map(label => (
              <button
                key={label}
                type="button"
                style={{ ...chipStyle, ...(title === label ? chipOnStyle : null) }}
                onClick={() => setTitle(label)}
              >{label}</button>
            ))}
          </div>
          <input
            style={fieldStyle}
            placeholder="What needs to get done?"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />

          <div style={{ ...hintStyle, textAlign: 'left', marginTop: 2 }}>Day</div>
          <div style={chipRowStyle}>
            <button type="button" style={{ ...chipStyle, ...(dueDate === todayKey() ? chipOnStyle : null) }} onClick={() => setDueDate(todayKey())}>Today</button>
            <button type="button" style={{ ...chipStyle, ...(dueDate === addDaysKey(1) ? chipOnStyle : null) }} onClick={() => setDueDate(addDaysKey(1))}>Tomorrow</button>
            <button type="button" style={{ ...chipStyle, ...(dueDate === nextMondayKey() ? chipOnStyle : null) }} onClick={() => setDueDate(nextMondayKey())}>Next Monday</button>
          </div>
          <input
            className="dm-date"
            type="date"
            style={fieldStyle}
            aria-label="Pick a day"
            value={dueDate}
            min={todayKey()}
            onChange={e => { if (e.target.value) setDueDate(e.target.value); }}
          />

          <div style={{ ...hintStyle, textAlign: 'left', marginTop: 2 }}>Time (optional)</div>
          <input
            className="dm-date"
            type="time"
            style={fieldStyle}
            aria-label="Time (optional)"
            value={dueTime}
            onChange={e => setDueTime(e.target.value)}
          />

          <textarea
            style={fieldStyle}
            rows={2}
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />

          {stop && propContacts.length > 0 && (
            <>
              <div style={{ ...hintStyle, textAlign: 'left', marginTop: 2 }}>Contact (optional)</div>
              <div style={chipRowStyle}>
                {propContacts.map(c => {
                  const fresh = Date.now() - new Date(c.created_at).getTime() < RECENT_CONTACT_MS;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      style={{ ...chipStyle, ...(contactId === c.id ? chipOnStyle : null) }}
                      onClick={() => setContactId(prev => (prev === c.id ? '' : c.id))}
                    >
                      {c.name}{fresh ? ' · just added' : ''}{c.contact_email ? '' : ' · no email'}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {stop && (
            <label style={linkLabelStyle}>
              <input type="checkbox" style={{ width: 'auto' }} checked={linkStop} onChange={e => setLinkStop(e.target.checked)} />
              Tie this to {stop.property_name}
            </label>
          )}

          <button type="button" style={saveBtn} disabled={busy || !title.trim()} onClick={save}>
            {busy ? 'Saving…' : `Add to To-Do for ${formatDueDate(dueDate).toLowerCase()}${dueTime ? ` at ${formatDueTime(dueTime)}` : ''}`}
          </button>
        </div>
      )}

      {msg && <div style={{ fontSize: 13, color: '#8fcf8f', marginTop: 10 }}>{msg}</div>}
      {error && <div style={{ fontSize: 13, color: '#f0a0a0', marginTop: 10 }}>{error}</div>}
    </div>
  );
}

const wrapStyle = { marginTop: 22, width: '100%', maxWidth: 360 };
const tabBtn = {
  flex: 1, padding: '11px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 10, color: '#f3ede0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const tabBtnOn = { background: '#9b773d', borderColor: '#9b773d' };
const panelStyle = { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 };
const fieldStyle = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.28)',
  color: '#f3ede0', borderRadius: 8, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit',
};
const saveBtn = {
  padding: '12px 0', background: '#f3ede0', color: '#14120f', border: 'none', borderRadius: 10,
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
const addBtn = {
  padding: '8px 16px', background: '#f3ede0', color: '#14120f', border: 'none', borderRadius: 8,
  fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
};
const chipRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const chipStyle = {
  padding: '8px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: 999, color: '#f3ede0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const chipOnStyle = { background: '#9b773d', borderColor: '#9b773d' };
const hintStyle = { fontSize: 12, color: 'rgba(255,255,255,0.55)' };
const nearRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.12)',
};
const linkLabelStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'left', margin: 0 };
