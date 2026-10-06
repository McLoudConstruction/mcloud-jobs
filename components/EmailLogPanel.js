'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { splitEmails, domainOf, isCompanyDomain } from '../lib/crmEmailAddresses';

// The email history for one Person, Property or Company, shown inside that
// record's popup. There is no stored link between a record and its emails:
// every message carries the addresses on it (filled by a database trigger),
// and this panel asks for the messages that involve any email address saved
// on the record. So the log follows the data. Change a contact's email or add
// a person to a company and the history moves with it.
//
//   Person:   their email and billing email
//   Property: the property contact plus every person linked to the property
//   Company:  the company contact, every person and property linked to it,
//             and anyone at the company's own email domain

const COLUMNS = 'id, direction, subject, snippet, body_text, from_email, to_email, cc_email, received_at, source';
const LIMIT = 100;

// Optional, comma separated. Keeps our own domain from making every internal
// email look like it belongs to a company. Set NEXT_PUBLIC_INTERNAL_EMAIL_DOMAINS.
const INTERNAL_DOMAINS = (process.env.NEXT_PUBLIC_INTERNAL_EMAIL_DOMAINS || '')
  .split(/[,\s]+/).map(d => d.trim().toLowerCase()).filter(Boolean);

function emailsOf(rows, columns) {
  return (rows || []).flatMap(r => columns.flatMap(c => splitEmails(r[c])));
}

async function collectAddresses(kind, id) {
  if (kind === 'contact') {
    const { data } = await supabase.from('contacts').select('contact_email, billing_email').eq('id', id).maybeSingle();
    return { addresses: emailsOf(data ? [data] : [], ['contact_email', 'billing_email']), domains: [] };
  }

  if (kind === 'property') {
    const [{ data: property }, { data: people }] = await Promise.all([
      supabase.from('properties').select('contact_email').eq('id', id).maybeSingle(),
      supabase.from('contacts').select('contact_email, billing_email').eq('property_id', id),
    ]);
    return {
      addresses: [...emailsOf(property ? [property] : [], ['contact_email']), ...emailsOf(people, ['contact_email', 'billing_email'])],
      domains: [],
    };
  }

  const [{ data: company }, { data: people }, { data: properties }] = await Promise.all([
    supabase.from('companies').select('contact_email').eq('id', id).maybeSingle(),
    supabase.from('contacts').select('contact_email, billing_email').eq('company_id', id),
    supabase.from('properties').select('contact_email').eq('company_id', id),
  ]);
  const ownEmails = [...emailsOf(company ? [company] : [], ['contact_email']), ...emailsOf(people, ['contact_email', 'billing_email'])];
  const domains = ownEmails.map(domainOf).filter(d => isCompanyDomain(d, INTERNAL_DOMAINS));
  return { addresses: [...ownEmails, ...emailsOf(properties, ['contact_email'])], domains };
}

function when(value) {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Row({ m }) {
  const [open, setOpen] = useState(false);
  const sent = m.direction === 'outbound';
  const preview = (m.snippet || m.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const body = (m.body_text || m.snippet || '').replace(/\n{3,}/g, '\n\n').trim();

  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
        aria-expanded={open}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: sent ? '#2F4858' : '#9B773D', marginRight: 8 }}>
              {sent ? 'Sent' : 'Received'}
            </span>
            {m.subject || '(no subject)'}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{when(m.received_at)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sent ? `To ${m.to_email || 'unknown'}` : `From ${m.from_email || 'unknown'}`}
          {!open && preview ? `  ·  ${preview}` : ''}
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {m.cc_email && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>Cc: {m.cc_email}</div>}
          {!sent && m.to_email && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>To: {m.to_email}</div>}
          <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', lineHeight: 1.5 }}>
            {body || '(no text)'}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmailLogPanel({ kind, recordId }) {
  const [messages, setMessages] = useState(null);
  const [noEmail, setNoEmail] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMessages(null);
      setError('');
      setNoEmail(false);
      try {
        const { addresses, domains } = await collectAddresses(kind, recordId);
        const uniqueAddresses = [...new Set(addresses)];
        const uniqueDomains = [...new Set(domains)];
        if (uniqueAddresses.length === 0 && uniqueDomains.length === 0) {
          if (!cancelled) { setNoEmail(true); setMessages([]); }
          return;
        }

        const queries = [];
        if (uniqueAddresses.length) {
          queries.push(supabase.from('email_messages').select(COLUMNS).overlaps('participants', uniqueAddresses).order('received_at', { ascending: false }).limit(LIMIT));
        }
        if (uniqueDomains.length) {
          queries.push(supabase.from('email_messages').select(COLUMNS).overlaps('participant_domains', uniqueDomains).order('received_at', { ascending: false }).limit(LIMIT));
        }
        const results = await Promise.all(queries);
        const failed = results.find(r => r.error);
        if (failed) throw new Error(failed.error.message);

        const byId = new Map();
        results.forEach(r => (r.data || []).forEach(m => byId.set(m.id, m)));
        const merged = [...byId.values()].sort((a, b) => new Date(b.received_at) - new Date(a.received_at)).slice(0, LIMIT);
        if (!cancelled) setMessages(merged);
      } catch (err) {
        if (!cancelled) {
          setError(/participants|participant_domains/.test(err.message) ? 'Email log is not ready yet. Run migration 154 in the Supabase SQL Editor.' : err.message);
          setMessages([]);
        }
      }
    }
    if (recordId) load();
    return () => { cancelled = true; };
  }, [kind, recordId]);

  return (
    <div style={{ marginTop: 22, paddingTop: 14, borderTop: '2px solid var(--line)' }}>
      <h4 style={{ margin: '0 0 4px' }}>
        Email log{messages && messages.length > 0 ? ` (${messages.length}${messages.length >= LIMIT ? '+' : ''})` : ''}
      </h4>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
        Sent and received email involving the addresses saved on this record.
      </div>
      {messages === null && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f' }}>{error}</div>}
      {noEmail && <div className="empty-state">Add an email address to this record to see its email history.</div>}
      {!error && !noEmail && messages && messages.length === 0 && (
        <div className="empty-state">No emails logged for this record yet.</div>
      )}
      {messages && messages.map(m => <Row key={m.id} m={m} />)}
    </div>
  );
}
