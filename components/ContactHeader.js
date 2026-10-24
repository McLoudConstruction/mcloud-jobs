'use client';
import { useEffect, useState } from 'react';
import RecencyDot from './RecencyDot';
import { recencyOf } from '../lib/contactRecency';
import { propertiesOfContact } from '../lib/contactProperties';
import { jobTitle } from '../lib/contactHistory';
import { formatPhone } from '../lib/constants';

// The top of the Person popup for someone already saved: who they are, how recently we reached them,
// the quick actions, and the properties they are linked to. It stays in view above the tabs.
//
//   lastAt         ISO date of the last counted contact, or undefined for never
//   recencyReady   false until the dates have loaded (and always false before migration 171)
//   propsVersion   changes when a property is linked or removed, so the chips reload

const MAX_CHIPS = 3;

export default function ContactHeader({
  contactId, form, lastAt, recencyReady, editMode, propsVersion,
  onActive, onEdit, onShowProperties,
}) {
  const [links, setLinks] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    propertiesOfContact(contactId).then(list => { if (!cancelled) setLinks(list); });
    return () => { cancelled = true; };
  }, [contactId, propsVersion]);

  const name = [form.first_name, form.last_name].filter(Boolean).join(' ') || 'Unnamed contact';
  const active = form.is_active !== false;
  const showRecency = recencyReady && active;
  const recency = showRecency ? recencyOf(lastAt) : null;
  const job = (form.management_company || form.position)
    ? jobTitle({ company_name: form.management_company, position: form.position })
    : '';
  const phoneDigits = (form.contact_phone || '').replace(/[^\d+]/g, '');

  const shown = (links || []).slice(0, MAX_CHIPS);
  const extra = (links || []).length - shown.length;

  return (
    <div className="cp-header">
      <div className="cp-top">
        <div className="cp-title">
          <h3>
            {recency && <RecencyDot lastAt={lastAt} size={11} />}
            {name}
          </h3>
          {form.contact_type && <span className="cp-chip">{form.contact_type}</span>}
        </div>
        <div className="cp-top-actions">
          {typeof form.is_active === 'boolean' && (
            <div className="tab-sections-pills" role="group" aria-label="Contact status">
              <button type="button" className={`tab-section-btn${active ? ' active' : ''}`} onClick={() => onActive(true)}>Active</button>
              <button
                type="button"
                className={`tab-section-btn${!active ? ' active' : ''}`}
                style={!active ? { background: 'var(--ink-soft)' } : undefined}
                onClick={() => onActive(false)}
              >Inactive</button>
            </div>
          )}
          {!editMode && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onEdit}>Edit Contact</button>
          )}
        </div>
      </div>

      {job && <div className="cp-sub">{job}</div>}

      {(form.contact_phone || form.contact_email) && (
        <div className="cp-reach">
          {form.contact_phone && <a href={`tel:${phoneDigits}`}>{formatPhone(form.contact_phone)}</a>}
          {form.contact_email && <a href={`mailto:${form.contact_email}`}>{form.contact_email}</a>}
        </div>
      )}

      {links && links.length > 0 && (
        <div className="cp-props" aria-label="Linked properties">
          {shown.map(l => (
            <span key={l.id} className={`cp-chip${l.isMain ? ' cp-chip-main' : ''}`} title={l.address || l.name}>
              {l.name}{l.isMain && links.length > 1 ? ' (main)' : ''}
            </span>
          ))}
          {extra > 0 && (
            <button type="button" className="cp-chip" style={{ cursor: 'pointer' }} onClick={onShowProperties}>+{extra} more</button>
          )}
        </div>
      )}

      {recency && <div className="cp-last">{recency.text}</div>}
    </div>
  );
}
