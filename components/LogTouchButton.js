'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';

// "Log a touch" for a Person, Property or Company (migration 163).
//
// Staff add the calls, visits, texts, emails, mailings and notes that happen
// outside the platform. They land in the same history the bots write to, so
// there is one list. A touch always belongs to a property, and optionally to
// one person there:
//   Property: the property is fixed, pick a person if it was one of them
//   Person:   the person's property is used (or pick one of their company's)
//   Company:  pick which of its properties it was about
//
// Saving also does the small bookkeeping a person would otherwise do by hand:
// a real contact updates "last contacted" and moves a new prospect to
// Contacted, and an optional next step sets the property's next action.
// The database checks the caller and the values, this screen only helps.

const TYPES = [
  { key: 'call', label: 'Call', channel: 'call' },
  { key: 'visit', label: 'Visit', channel: 'visit' },
  { key: 'text', label: 'Text', channel: 'text' },
  { key: 'email', label: 'Email', channel: 'email' },
  { key: 'mail', label: 'Mail', channel: 'mail' },
  { key: 'note', label: 'Note', channel: 'other' },
];

// What happened, by type. The first entry is the default.
const OUTCOMES = {
  call: [['connected', 'Spoke with them'], ['voicemail', 'Left a voicemail'], ['no_answer', 'No answer'], ['meeting_set', 'Meeting set'], ['interested', 'Interested'], ['not_interested', 'Not interested'], ['wrong_contact', 'Wrong person or number']],
  visit: [['connected', 'Spoke with them'], ['no_answer', 'Nobody there'], ['meeting_set', 'Meeting set'], ['interested', 'Interested'], ['not_interested', 'Not interested']],
  text: [['sent', 'Sent'], ['replied', 'They replied'], ['interested', 'Interested'], ['not_interested', 'Not interested'], ['wrong_contact', 'Wrong number']],
  email: [['sent', 'Sent'], ['replied', 'They replied'], ['bounced', 'Bounced'], ['interested', 'Interested'], ['not_interested', 'Not interested'], ['unsubscribed', 'Asked to stop emails'], ['wrong_contact', 'Wrong person']],
  mail: [['sent', 'Sent'], ['replied', 'They replied'], ['interested', 'Interested'], ['not_interested', 'Not interested'], ['wrong_contact', 'Wrong address']],
};

function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortDay(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LogTouchButton({ kind, recordId, onLogged, className = 'btn btn-sm' }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [properties, setProperties] = useState([]);   // choices when the property is not fixed
  const [propertyId, setPropertyId] = useState('');
  const [fixedPerson, setFixedPerson] = useState(null); // { id, name } when opened from a Person
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState('');
  const [nextStep, setNextStep] = useState(null);       // the property's current next action, for reference

  const [type, setType] = useState('call');
  const [outcome, setOutcome] = useState('connected');
  const [inbound, setInbound] = useState(false);
  const [when, setWhen] = useState(nowLocalInput());
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');

  async function loadProperty(id) {
    setPeople([]); setNextStep(null);
    if (!id) return;
    const [{ data: contacts }, { data: prop }] = await Promise.all([
      supabase.from('contacts').select('id, name').eq('property_id', id).order('name'),
      supabase.from('properties').select('next_action_at, next_action_note').eq('id', id).maybeSingle(),
    ]);
    setPeople(contacts || []);
    if (prop?.next_action_at) setNextStep({ at: prop.next_action_at, note: prop.next_action_note || '' });
  }

  async function openDialog() {
    setOpen(true);
    setError('');
    setSaving(false);
    setType('call'); setOutcome('connected'); setInbound(false);
    setWhen(nowLocalInput()); setNote(''); setNextDate(''); setNextNote('');
    setProperties([]); setPropertyId(''); setFixedPerson(null); setPeople([]); setPersonId(''); setNextStep(null);
    setLoading(true);
    try {
      if (kind === 'property') {
        setPropertyId(recordId);
        await loadProperty(recordId);
      } else if (kind === 'contact') {
        const { data: c } = await supabase.from('contacts').select('id, name, property_id, company_id').eq('id', recordId).maybeSingle();
        if (!c) { setError('Could not find this person.'); return; }
        setFixedPerson({ id: c.id, name: c.name || 'this person' });
        setPersonId(c.id);
        if (c.property_id) {
          setPropertyId(c.property_id);
          const { data: prop } = await supabase.from('properties').select('next_action_at, next_action_note').eq('id', c.property_id).maybeSingle();
          if (prop?.next_action_at) setNextStep({ at: prop.next_action_at, note: prop.next_action_note || '' });
        } else if (c.company_id) {
          const { data: props } = await supabase.from('properties').select('id, property_name').eq('company_id', c.company_id).order('property_name');
          setProperties(props || []);
          if (props?.length === 1) { setPropertyId(props[0].id); await loadProperty(props[0].id); setPersonId(c.id); }
          if (!props?.length) setError('This person is not linked to a property yet. Link them to one first, so the touch has a home.');
        } else {
          setError('This person is not linked to a property yet. Link them to one first, so the touch has a home.');
        }
      } else {
        const { data: props } = await supabase.from('properties').select('id, property_name').eq('company_id', recordId).order('property_name');
        setProperties(props || []);
        if (props?.length === 1) { setPropertyId(props[0].id); await loadProperty(props[0].id); }
        if (!props?.length) setError('This company has no properties yet. Add a property first, so the touch has a home.');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function pickType(key) {
    setType(key);
    setOutcome(key === 'note' ? 'note' : OUTCOMES[key][0][0]);
    if (key === 'note') setInbound(false);
  }

  async function pickProperty(id) {
    setPropertyId(id);
    if (!fixedPerson) setPersonId('');
    await loadProperty(id);
  }

  async function save() {
    setError('');
    if (!propertyId) { setError('Pick the property this was about.'); return; }
    if (type === 'note' && !note.trim()) { setError('Write the note first.'); return; }
    if (nextNote.trim() && !nextDate) { setError('Pick a date for the next step, or clear its note.'); return; }
    const happened = new Date(when);
    if (Number.isNaN(happened.getTime())) { setError('That date and time is not valid.'); return; }

    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('crm_log_touch', {
      p_property_id: propertyId,
      p_contact_id: personId || null,
      p_channel: TYPES.find(t => t.key === type).channel,
      p_outcome: type === 'note' ? 'note' : outcome,
      p_direction: inbound ? 'inbound' : 'outbound',
      p_note: note.trim() || null,
      p_happened_at: happened.toISOString(),
      p_next_action_at: nextDate ? new Date(`${nextDate}T09:00:00`).toISOString() : null,
      p_next_action_note: nextNote.trim() || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(/crm_log_touch/.test(rpcError.message) && /not.*find|does not exist/i.test(rpcError.message)
        ? 'Logging touches is not set up yet. Run migration 163 in the Supabase SQL Editor.'
        : rpcError.message);
      return;
    }
    if (data && data.ok === false) { setError(data.error || 'Could not save that touch.'); return; }
    setOpen(false);
    if (onLogged) await onLogged(data);
  }

  // Only ask which property when there is a real choice to make.
  const needsPropertyChoice = properties.length > 1;
  const outcomes = OUTCOMES[type] || [];
  const blocked = !loading && !propertyId && properties.length === 0;

  return (
    <>
      <button type="button" className={className} onClick={openDialog}>Log a touch</button>
      <PopupModal open={open} onClose={() => { if (!saving) setOpen(false); }} maxWidth={520}>
        <div onClick={e => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 4px' }}>Log a touch</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
            Add a call, visit, text, email, mailing or note. It goes in the same history the bots write to.
          </div>

          {loading && <div style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '10px 0' }}>Loading…</div>}
          {error && <div className="error-text" style={{ margin: '10px 0' }}>{error}</div>}

          {!loading && !blocked && (
            <>
              {needsPropertyChoice && (
                <>
                  <label>Which property</label>
                  <select value={propertyId} onChange={e => pickProperty(e.target.value)}>
                    <option value="">Pick a property</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.property_name || 'Unnamed property'}</option>)}
                  </select>
                </>
              )}

              {fixedPerson ? (
                <div style={{ fontSize: 13, margin: '10px 0 0' }}>With <strong>{fixedPerson.name}</strong></div>
              ) : (
                people.length > 0 && (
                  <>
                    <label>Who was it with</label>
                    <select value={personId} onChange={e => setPersonId(e.target.value)}>
                      <option value="">Not a specific person</option>
                      {people.map(p => <option key={p.id} value={p.id}>{p.name || 'Unnamed person'}</option>)}
                    </select>
                  </>
                )
              )}

              <label>What kind of touch</label>
              <div className="tab-sections-pills">
                {TYPES.map(t => (
                  <button key={t.key} type="button" className={`tab-section-btn ${type === t.key ? 'active' : ''}`} onClick={() => pickType(t.key)}>{t.label}</button>
                ))}
              </div>

              {type !== 'note' && (
                <>
                  <label>What happened</label>
                  <select value={outcome} onChange={e => setOutcome(e.target.value)}>
                    {outcomes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={inbound} onChange={e => setInbound(e.target.checked)} style={{ width: 'auto' }} />
                    They contacted us
                  </label>
                </>
              )}

              <label>When</label>
              <input type="datetime-local" value={when} max={nowLocalInput()} onChange={e => setWhen(e.target.value)} />

              <label>{type === 'note' ? 'Note' : 'Note (optional)'}</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder={type === 'note' ? 'What do you want to remember?' : 'What was said, what they need, who to ask for next time'} />

              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>Next step (optional)</div>
                {nextStep && (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                    Current next step: {shortDay(nextStep.at)}{nextStep.note ? `, ${nextStep.note}` : ''}. Setting a date here replaces it.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 0 170px' }}>
                    <label>Date</label>
                    <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label>What to do</label>
                    <input type="text" value={nextNote} onChange={e => setNextNote(e.target.value)} maxLength={300} placeholder="Send the estimate" />
                  </div>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            {!blocked && (
              <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving || loading || !propertyId}>
                {saving ? 'Saving…' : 'Save touch'}
              </button>
            )}
          </div>
        </div>
      </PopupModal>
    </>
  );
}
