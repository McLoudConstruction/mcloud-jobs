'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import LogTouchButton from './LogTouchButton';
import { useStaffAuth } from '../lib/staffAuthContext';

// Every time a Person, Property or Company was contacted, newest first.
//
// Sources, merged by the database (crm_touch_timeline, migration 162):
//   Staff     calls, visits, texts and notes logged by hand (migration 163)
//   Bot       outreach logged through the bot API
//   Sequence  emails from the platform's email sequences, and their replies
//   Email     mail sent or received in a connected mailbox
//
// Contact rolls up. A touch on a person also shows on the property and the
// company they are linked to, with their name beside it, so opening a
// property or company tells you who was reached there and when.
//   Person:   their own touches
//   Property: the property and everyone linked to it
//   Company:  the company, its properties, and everyone linked to either

const PAGE = 50;

// Marks touches that were edited by hand. The timeline feed does not carry this, so look it up
// for the hand logged and bot logged rows on the page.
async function withEdits(items) {
  const ids = (items || []).filter(i => i.source === 'staff' || i.source === 'touch').map(i => i.id);
  if (ids.length === 0) return items || [];
  const { data } = await supabase.from('outreach_touches').select('id, edited_at, edited_by_name').in('id', ids).not('edited_at', 'is', null);
  const edits = new Map((data || []).map(r => [r.id, r]));
  return items.map(i => (edits.has(i.id) ? { ...i, edited_at: edits.get(i.id).edited_at, edited_by: edits.get(i.id).edited_by_name } : i));
}

// Optional, comma separated. Keeps our own domain from making every internal
// email look like it belongs to a company. Set NEXT_PUBLIC_INTERNAL_EMAIL_DOMAINS.
const INTERNAL_DOMAINS = (process.env.NEXT_PUBLIC_INTERNAL_EMAIL_DOMAINS || '')
  .split(/[,\s]+/).map(d => d.trim().toLowerCase()).filter(Boolean);

const CHANNELS = { email: 'Email', call: 'Call', text: 'Text', mail: 'Mail', visit: 'Visit', other: 'Other' };
const OUTCOMES = {
  sent: 'sent', replied: 'replied', bounced: 'bounced', interested: 'interested', not_interested: 'not interested',
  unsubscribed: 'unsubscribed', no_answer: 'no answer', voicemail: 'left a voicemail', meeting_set: 'meeting set',
  wrong_contact: 'wrong contact', opened: 'opened', clicked: 'clicked a link', received: 'received',
  connected: 'spoke with them', note: 'note',
};
const SOURCES = {
  staff: { label: 'Staff', color: '#8A3F3F' },
  touch: { label: 'Bot', color: '#9B773D' },
  sequence: { label: 'Sequence', color: '#3A6B45' },
  email: { label: 'Email', color: '#2F4858' },
};

function when(value) {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function day(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Call, left a voicemail", "Email sent", "Sequence reply".
function titleFor(item) {
  if (item.source === 'email') return item.kind === 'sent' ? 'Email sent' : 'Email received';
  if (item.source === 'sequence') {
    if (item.kind === 'sent') return 'Sequence email sent';
    return `Sequence email ${OUTCOMES[item.kind] || item.kind}`;
  }
  if (item.kind === 'note') return 'Note';
  const channel = CHANNELS[item.channel] || item.channel;
  const outcome = OUTCOMES[item.kind] || item.kind;
  return item.direction === 'inbound' ? `${channel} from them, ${outcome}` : `${channel}, ${outcome}`;
}

function viaText(item, kind, recordId) {
  const parts = [];
  if (item.person_name && !(kind === 'contact' && item.person_id === recordId)) parts.push(`with ${item.person_name}`);
  if (kind === 'company' && item.property_name) parts.push(`at ${item.property_name}`);
  return parts.join(' ');
}

// A date-time-local input value for a timestamp, in local time.
function toLocalInput(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EFFECTS = {
  address_unblocked: 'That change lifted the block on this email address.',
  address_blocked: 'That change blocked this email address.',
};

function Row({ item, kind, recordId, isOwner, onChanged }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rowMessage, setRowMessage] = useState('');
  // Hand logged and bot logged touches can be fixed. Mail and sequence rows come from
  // the mailbox and the sequences, so they stay as they are. A bot's touch is for owners only.
  const canChange = (item.source === 'staff') || (item.source === 'touch' && isOwner);

  function startEdit() {
    setDraft({
      channel: item.channel || 'other',
      outcome: item.kind || 'note',
      note: item.note || '',
      at: toLocalInput(item.at),
    });
    setEditing(true);
    setOpen(true);
    setRowMessage('');
  }

  async function saveEdit() {
    setBusy(true);
    const atIso = draft.at ? new Date(draft.at).toISOString() : null;
    const { data, error: rpcError } = await supabase.rpc('crm_edit_touch', {
      p_touch_id: item.id,
      p_channel: draft.channel,
      p_outcome: draft.outcome,
      p_note: draft.note,
      p_happened_at: atIso,
      p_clear_note: !draft.note.trim(),
    });
    setBusy(false);
    if (rpcError) { setRowMessage(rpcError.message); return; }
    setEditing(false);
    onChanged(EFFECTS[data?.effect] || '');
  }

  async function remove() {
    if (!confirm('Delete this touch? It comes off the history. The stage and next step on the record are not changed. A copy is kept in the audit log.')) return;
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('crm_delete_touch', { p_touch_id: item.id });
    setBusy(false);
    if (rpcError) { setRowMessage(rpcError.message); return; }
    onChanged(EFFECTS[data?.effect] || '');
  }

  const [body, setBody] = useState(null);
  const source = SOURCES[item.source] || SOURCES.touch;
  const via = viaText(item, kind, recordId);
  const preview = (item.summary || item.note || '').replace(/\s+/g, ' ').trim();
  const isMail = item.source === 'email';

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Mail bodies are fetched only when someone opens the row.
    if (next && isMail && body === null) {
      const { data } = await supabase.from('email_messages').select('body_text, snippet, from_email, to_email, cc_email').eq('id', item.id).maybeSingle();
      setBody(data || {});
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
      <button type="button" onClick={toggle} aria-expanded={open} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: source.color, marginRight: 8 }}>{source.label}</span>
            {titleFor(item)}
            {via && <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>{`  ${via}`}</span>}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{when(item.at)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[item.actor && (item.source === 'touch' || item.source === 'staff' ? `by ${item.actor}` : item.actor), item.email, !open && preview].filter(Boolean).join('  ·  ')}
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5 }}>
          {item.summary && <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.summary}</div>}
          {!isMail && item.note && <div style={{ whiteSpace: 'pre-wrap' }}>{item.note}</div>}
          {isMail && (
            <>
              {body?.from_email && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>From: {body.from_email}</div>}
              {body?.to_email && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>To: {body.to_email}</div>}
              {body?.cc_email && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>Cc: {body.cc_email}</div>}
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
                {body === null ? 'Loading…' : (body.body_text || body.snippet || item.note || '(no text)').replace(/\n{3,}/g, '\n\n').trim()}
              </div>
            </>
          )}
          {!item.summary && !item.note && !isMail && !editing && <div style={{ color: 'var(--ink-soft)' }}>No note was added.</div>}

          {editing && draft && (
            <div style={{ marginTop: 8 }}>
              <div className="two-col">
                <div>
                  <label>Type</label>
                  <select value={draft.channel} onChange={e => setDraft({ ...draft, channel: e.target.value })}>
                    {Object.entries(CHANNELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label>What happened</label>
                  <select value={draft.outcome} onChange={e => setDraft({ ...draft, outcome: e.target.value })}>
                    {Object.entries(OUTCOMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label>When</label>
                  <input type="datetime-local" value={draft.at} onChange={e => setDraft({ ...draft, at: e.target.value })} />
                </div>
              </div>
              <label style={{ marginTop: 8 }}>Note</label>
              <textarea value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} maxLength={2000} />
              {(draft.outcome === 'bounced' || draft.outcome === 'unsubscribed' || item.kind === 'bounced' || item.kind === 'unsubscribed') && draft.outcome !== item.kind && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Changing a bounced or unsubscribed touch also changes whether this email address is blocked.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}

          {!editing && canChange && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-sm" onClick={startEdit} disabled={busy}>Edit</button>
              <button type="button" className="btn btn-sm" onClick={remove} disabled={busy}>Delete</button>
            </div>
          )}
          {item.edited_at && !editing && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
              Edited {when(item.edited_at)}{item.edited_by ? ` by ${item.edited_by}` : ''}
            </div>
          )}
          {rowMessage && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{rowMessage}</div>}
        </div>
      )}
    </div>
  );
}

function Headline({ summary, kind }) {
  if (!summary) return null;
  if (!summary.total) {
    return <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Not contacted yet</div>;
  }
  const last = summary.last || {};
  // Name who it was with only when the record is not that person or property itself.
  const who = [
    kind !== 'contact' && last.person_name && `with ${last.person_name}`,
    kind === 'company' && last.property_name && `at ${last.property_name}`,
  ].filter(Boolean).join(' ');
  return (
    <div style={{ fontSize: 13, marginBottom: 6, lineHeight: 1.5 }}>
      <strong>Last touch {day(summary.last_at)}</strong>
      {`: ${titleFor({ source: last.source, channel: last.channel, direction: last.direction, kind: last.kind }).toLowerCase()}`}
      {who && `, ${who}`}
      <span style={{ color: 'var(--ink-soft)' }}>{`  ·  ${summary.total} touch${summary.total === 1 ? '' : 'es'} in all`}</span>
    </div>
  );
}

export default function TouchTimeline({ kind, recordId, bare = false }) {
  const [items, setItems] = useState(null);
  const [summary, setSummary] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState('');
  const { role } = useStaffAuth() || {};
  const isOwner = role === 'owner';

  const fetchPage = useCallback(async (after) => {
    const { data, error: rpcError } = await supabase.rpc('crm_touch_timeline', {
      p_kind: kind,
      p_id: recordId,
      p_limit: PAGE,
      p_cursor: after || null,
      p_internal_domains: INTERNAL_DOMAINS,
    });
    if (rpcError) throw new Error(/crm_touch_timeline/.test(rpcError.message) && /not.*find|does not exist/i.test(rpcError.message)
      ? 'Touch history is not set up yet. Run migration 162 in the Supabase SQL Editor.'
      : rpcError.message);
    return data;
  }, [kind, recordId]);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setSummary(null); setCursor(null); setError(''); setFilter('all');
    if (!recordId) return undefined;
    fetchPage(null)
      .then(async data => {
        const list = await withEdits(data.items || []);
        if (cancelled) return;
        setItems(list);
        setSummary(data.summary || null);
        setCursor(data.next_cursor || null);
      })
      .catch(err => { if (!cancelled) { setError(err.message); setItems([]); } });
    return () => { cancelled = true; };
  }, [fetchPage, recordId, reloadKey]);

  async function showMore() {
    setMore(true);
    try {
      const data = await fetchPage(cursor);
      const list = await withEdits(data.items || []);
      setItems(prev => [...(prev || []), ...list]);
      setCursor(data.next_cursor || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setMore(false);
    }
  }

  const shown = (items || []).filter(i => filter === 'all' || (filter === 'email' ? i.channel === 'email' : i.channel !== 'email'));

  return (
    <div style={bare ? undefined : { marginTop: 22, paddingTop: 14, borderTop: '2px solid var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '0 0 4px' }}>
        <h4 style={{ margin: 0 }}>Touches</h4>
        <LogTouchButton kind={kind} recordId={recordId} onLogged={() => setReloadKey(k => k + 1)} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
        {kind === 'contact'
          ? 'Every email, call, visit and message with this person.'
          : `Every touch with this ${kind === 'property' ? 'property' : 'company'} and the people linked to it${kind === 'company' ? ' and its properties' : ''}.`}
      </div>

      {items === null && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 6 }}>{error}</div>}
      {items !== null && !error && <Headline summary={summary} kind={kind} />}

      {items && items.length > 0 && (
        <div className="tab-sections-pills" style={{ margin: '4px 0 6px' }}>
          {[['all', 'All'], ['email', 'Email'], ['other', 'Calls and other']].map(([key, text]) => (
            <button key={key} type="button" className={`tab-section-btn ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{text}</button>
          ))}
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="empty-state">No touches yet. Use Log a touch to add a call, visit or note. Activity from bots and mail from a connected mailbox will show here too.</div>
      )}
      {items && items.length > 0 && shown.length === 0 && <div className="empty-state">Nothing in this view.</div>}
      {notice && <div style={{ fontSize: 12.5, color: '#3a6b45', margin: '6px 0' }}>{notice}</div>}
      {shown.map(item => (
        <Row key={`${item.source}-${item.id}`} item={item} kind={kind} recordId={recordId} isOwner={isOwner}
          onChanged={msg => { setNotice(msg); setReloadKey(k => k + 1); }} />
      ))}

      {cursor && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={showMore} disabled={more}>{more ? 'Loading…' : 'Show more'}</button>
        </div>
      )}
    </div>
  );
}
