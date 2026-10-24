'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  propertiesOfContact, searchProperties, linkContactToProperty, unlinkContactFromProperty,
} from '../lib/contactProperties';

// Every property one person is linked to. Shown on the Person popup.
//
// The one marked Main is the property named in the Main property field on the Details tab. The rest
// are extra links: a manager who looks after several buildings is one person here, and shows up under
// each of those properties. This card is on the Overview tab, where adding and removing is always on.

export default function ContactPropertiesCard({ contactId, canEdit, onChanged }) {
  const [links, setLinks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!contactId) { setLinks([]); return; }
    setLinks(await propertiesOfContact(contactId));
  }, [contactId]);

  useEffect(() => {
    setLinks(null); setAdding(false); setTerm(''); setResults([]); setMessage(''); setError('');
    load();
  }, [load]);

  // Leaving edit mode closes the picker.
  useEffect(() => { if (!canEdit) { setAdding(false); setTerm(''); setResults([]); } }, [canEdit]);

  // Look up properties as the user types.
  useEffect(() => {
    if (!adding) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchProperties(term, (links || []).map(l => l.id));
      if (!cancelled) setResults(found);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, adding, links]);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(''), 3500);
  }

  async function add(property) {
    setBusy(true); setError('');
    const res = await linkContactToProperty(contactId, property.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setAdding(false); setTerm(''); setResults([]);
    flash(res.already ? `Already linked to ${property.name}.` : `Linked to ${property.name}.`);
    await load();
    if (onChanged) await onChanged(res);
  }

  async function remove(link) {
    const extra = (links || []).length > 1;
    const note = link.isMain && extra
      ? ' Their next property becomes the main one.'
      : '';
    if (!confirm(`Remove this person from ${link.name}? They stay in People and keep their other properties.${note}`)) return;
    setBusy(true); setError('');
    const res = await unlinkContactFromProperty(contactId, link.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    flash(`Removed from ${link.name}.`);
    await load();
    if (onChanged) await onChanged(res);
  }

  if (!contactId) return null;
  const count = links ? links.length : 0;

  return (
    <div className="contact-history-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h4 style={{ margin: 0 }}>Properties{links && count > 0 ? ` (${count})` : ''}</h4>
        {canEdit && !adding && (
          <button type="button" className="btn btn-sm" onClick={() => { setAdding(true); setError(''); }} disabled={busy}>+ Link a property</button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '2px 0 8px' }}>
        {canEdit
          ? 'One person can be linked to several properties. Their main property is set under Edit Contact, on the Details tab.'
          : 'Every property this person is linked to.'}
      </div>

      {links === null && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}
      {links && links.length === 0 && <div className="empty-state">Not linked to a property yet.</div>}

      {links && links.map(link => (
        <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)', minWidth: 0 }}>
          <div style={{ minWidth: 0, fontSize: 13 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {link.name}
              {link.isMain && (
                <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Main</span>
              )}
            </div>
            {link.address && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.address}</div>
            )}
          </div>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(link)} disabled={busy}>Remove</button>
          )}
        </div>
      ))}

      {adding && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginTop: 10 }}>
          <label style={{ marginTop: 0 }}>Find a property</label>
          <input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Property name or street" />
          {term.trim().length >= 2 && results.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>No other properties match.</div>
          )}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              disabled={busy}
              style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px 4px', borderBottom: '1px solid var(--line)' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
              {p.address && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.address}</div>}
            </button>
          ))}
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { setAdding(false); setTerm(''); setResults([]); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 6 }}>{message}</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
