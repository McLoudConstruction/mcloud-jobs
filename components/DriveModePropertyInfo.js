'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatPhone } from '../lib/constants';
import SiteRequestForm from './SiteRequestForm';

// Drive Mode: jot a note, add a contact (with title), or log a site
// request for the stop you are at.
// Notes go on the property's own notes field, newest first with the date.
// Contacts go in the same contacts table the Properties page uses.
const EMPTY = { name: '', position: '', phone: '', email: '' };

export default function DriveModePropertyInfo({ stop }) {
  const [open, setOpen] = useState(null); // null | 'note' | 'contact' | 'site'
  const [existingNotes, setExistingNotes] = useState('');
  const [contacts, setContacts] = useState([]);
  const [note, setNote] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const propertyId = stop?.property_id;

  async function load() {
    if (!propertyId) return;
    const [{ data: prop }, { data: list }] = await Promise.all([
      supabase.from('properties').select('notes').eq('id', propertyId).maybeSingle(),
      supabase.from('contacts').select('id, name, position, contact_phone, contact_email').eq('property_id', propertyId).order('created_at', { ascending: false }),
    ]);
    setExistingNotes(prop?.notes || '');
    setContacts(list || []);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [propertyId]);

  if (!propertyId) return null;

  function toggle(which) {
    setMsg(''); setError('');
    setOpen(prev => (prev === which ? null : which));
  }

  async function saveNote() {
    const text = note.trim();
    if (!text) return;
    setBusy(true); setError(''); setMsg('');
    const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    // Re-read right before writing so a note added elsewhere is not overwritten.
    const { data: prop, error: readErr } = await supabase.from('properties').select('notes').eq('id', propertyId).maybeSingle();
    if (readErr) { setBusy(false); setError(readErr.message); return; }
    const merged = `[${stamp}] ${text}${prop?.notes ? `\n${prop.notes}` : ''}`;
    const { error: err } = await supabase.from('properties').update({ notes: merged }).eq('id', propertyId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setExistingNotes(merged);
    setNote('');
    setOpen(null);
    setMsg('Note saved.');
  }

  async function saveContact() {
    const name = form.name.trim();
    if (!name) { setError('Add a name.'); return; }
    setBusy(true); setError(''); setMsg('');
    const { data: prop } = await supabase.from('properties')
      .select('property_name, property_type, management_company, property_street, property_unit, property_city, property_state, property_zip, contact_name')
      .eq('id', propertyId).maybeSingle();
    const { error: err } = await supabase.from('contacts').insert({
      name,
      first_name: name.split(' ')[0],
      last_name: name.split(' ').slice(1).join(' '),
      role: 'Property Contact',
      position: form.position.trim() || null,
      contact_phone: form.phone || null,
      contact_email: form.email.trim() || null,
      property_id: propertyId,
      contact_type: prop?.property_type || stop.property_type || null,
      property: prop?.property_name || stop.property_name || null,
      management_company: prop?.management_company || stop.management_company || null,
      address_street: prop?.property_street || stop.property_street || null,
      address_unit: prop?.property_unit || null,
      address_city: prop?.property_city || stop.property_city || null,
      address_state: prop?.property_state || stop.property_state || null,
      address_zip: prop?.property_zip || stop.property_zip || null,
    });
    if (err) { setBusy(false); setError(err.message); return; }
    // First contact on a property also fills the property's own contact fields.
    if (prop && !prop.contact_name) {
      await supabase.from('properties').update({
        contact_name: name, contact_phone: form.phone || null, contact_email: form.email.trim() || null,
      }).eq('id', propertyId);
    }
    setBusy(false);
    setForm(EMPTY);
    setOpen(null);
    setMsg('Contact saved.');
    load();
  }

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={{ ...tabBtn, ...(open === 'note' ? tabBtnOn : null) }} onClick={() => toggle('note')}>Add note</button>
        <button type="button" style={{ ...tabBtn, ...(open === 'contact' ? tabBtnOn : null) }} onClick={() => toggle('contact')}>Add contact</button>
        <button type="button" style={{ ...tabBtn, ...(open === 'site' ? tabBtnOn : null) }} onClick={() => toggle('site')}>Site request</button>
      </div>

      {open === 'note' && (
        <div style={panelStyle}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What happened at this stop?"
            rows={4}
            style={fieldStyle}
            autoFocus
          />
          <button type="button" style={saveBtn} disabled={busy || !note.trim()} onClick={saveNote}>{busy ? 'Saving…' : 'Save note'}</button>
        </div>
      )}

      {open === 'contact' && (
        <div style={panelStyle}>
          <input style={fieldStyle} placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          <input style={fieldStyle} placeholder="Title (e.g. Property Manager)" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
          <input style={fieldStyle} placeholder="Phone" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} />
          <input style={fieldStyle} placeholder="Email" inputMode="email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <button type="button" style={saveBtn} disabled={busy || !form.name.trim()} onClick={saveContact}>{busy ? 'Saving…' : 'Save contact'}</button>
        </div>
      )}

      {open === 'site' && (
        <SiteRequestForm
          stop={stop}
          contacts={contacts}
          onSaved={(photoCount) => {
            setOpen(null);
            setMsg(`Site request saved${photoCount ? ` with ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}. Find it in Sales.`);
            load();
          }}
        />
      )}

      {msg && <div style={{ fontSize: 13, color: '#8fcf8f', marginTop: 10 }}>{msg}</div>}
      {error && <div style={{ fontSize: 13, color: '#f0a0a0', marginTop: 10 }}>{error}</div>}

      {open === null && (contacts.length > 0 || existingNotes) && (
        <div style={{ marginTop: 14, textAlign: 'left', fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>
          {contacts.slice(0, 3).map(c => (
            <div key={c.id} style={{ marginBottom: 4 }}>
              <strong style={{ color: '#f3ede0' }}>{c.name}</strong>{c.position ? `, ${c.position}` : ''}
              {c.contact_phone ? <> · <a href={`tel:${c.contact_phone}`} style={{ color: 'inherit' }}>{c.contact_phone}</a></> : null}
            </div>
          ))}
          {existingNotes && (
            <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 64, overflow: 'hidden' }}>
              {existingNotes.split('\n').slice(0, 2).join('\n')}
            </div>
          )}
        </div>
      )}
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
