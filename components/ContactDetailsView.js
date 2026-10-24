'use client';
import { formatAddress } from './AddressFields';
import { PHONE_TYPES, EMAIL_CONFIDENCE, EMAIL_BLOCK_LABELS, formatPhone } from '../lib/constants';

// The Details tab when not editing: only the fields that have something in them, two or three to a row.
// An empty field takes no room, so a contact with little on file reads as a short list rather than a
// form full of blank boxes. Press Edit Contact to see every field.

const has = v => (v ?? '').toString().trim() !== '';
const label = (list, value) => list.find(o => o.value === value)?.label || '';

export default function ContactDetailsView({ form, billingDifferent, isHomeowner, isRealEstateAgent }) {
  const rows = [];
  const add = (title, content, wide = false) => rows.push({ title, content, wide });

  if (has(form.contact_phone)) {
    const type = label(PHONE_TYPES, form.phone_type);
    add('Phone', <>
      <a href={`tel:${form.contact_phone.replace(/[^\d+]/g, '')}`}>{formatPhone(form.contact_phone)}</a>
      {type && <span className="kv-tag">{type}</span>}
    </>);
  }
  if (has(form.contact_phone2)) {
    const type = label(PHONE_TYPES, form.phone2_type);
    add('Second phone', <>
      <a href={`tel:${form.contact_phone2.replace(/[^\d+]/g, '')}`}>{formatPhone(form.contact_phone2)}</a>
      {type && <span className="kv-tag">{type}</span>}
    </>);
  }
  if (has(form.contact_email)) {
    const confidence = label(EMAIL_CONFIDENCE, form.email_confidence);
    const blocked = form.email_blocked_reason ? EMAIL_BLOCK_LABELS[form.email_blocked_reason] : '';
    add('Email', <>
      <a href={`mailto:${form.contact_email}`}>{form.contact_email}</a>
      {blocked
        ? <span className="kv-tag" style={{ color: '#a13f3f' }}>{blocked}</span>
        : confidence && <span className="kv-tag">{confidence}</span>}
    </>);
  }
  if (!isHomeowner && has(form.billing_email)) add('Billing email', <a href={`mailto:${form.billing_email}`}>{form.billing_email}</a>);
  if (!isHomeowner && has(form.management_company)) add(isRealEstateAgent ? 'Brokerage' : 'Company', form.management_company);
  if (isRealEstateAgent && has(form.team_office)) add('Team/Office', form.team_office);
  if (has(form.property)) add('Main property', form.property);
  if (has(formatAddress(form, 'address'))) add('Address', formatAddress(form, 'address'), true);
  if (!isHomeowner && billingDifferent && has(formatAddress(form, 'billing'))) add('Billing address', formatAddress(form, 'billing'), true);

  const flags = [];
  if (form.automated_emails_opt_out) flags.push('Automated emails are off');
  if (form.shared_email) flags.push('Shares an email with someone else');
  if (form.is_test) flags.push('Test record');
  if (flags.length > 0) add('Record settings', flags.join('. '), true);

  if (rows.length === 0) {
    return <div className="empty-state">Nothing else is on file for this person. Press Edit Contact to add a phone, email, address or company.</div>;
  }

  return (
    <dl className="contact-kv">
      {rows.map(r => (
        <div key={r.title} className={r.wide ? 'kv-wide' : undefined}>
          <dt>{r.title}</dt>
          <dd>{r.content}</dd>
        </div>
      ))}
    </dl>
  );
}
