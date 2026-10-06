'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  MERGE_FIELDS, PROVIDERS, listComposeTemplates, fillTemplate, buildComposeUrl,
  getSavedProvider, saveProvider,
} from '../lib/composeTemplates';

// Settings editor for the saved email templates behind the Email button.
// Add, edit, reorder and delete templates. Use merge fields like
// {{first_name}} and they are filled in when the email is opened.

const EMPTY = { id: null, name: '', subject: '', body: '' };

const PREVIEW_VARS = {
  first_name: 'Jordan',
  full_name: 'Jordan Smith',
  company: 'Example Management',
  property: 'Riverside Plaza',
  sender_name: 'Your Name',
};

export default function EmailTemplatesCard() {
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('default');
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const lastFocus = useRef('body');

  useEffect(() => { setProvider(getSavedProvider()); }, []);

  async function load() {
    try {
      setTemplates(await listComposeTemplates());
      setError('');
    } catch (e) {
      setError('Could not load templates. Run migration 155 in Supabase first.');
    }
    setLoaded(true);
  }

  useEffect(() => { load(); }, []);

  function startNew() { setDraft({ ...EMPTY }); setMsg(''); setError(''); }
  function startEdit(t) { setDraft({ id: t.id, name: t.name, subject: t.subject, body: t.body }); setMsg(''); setError(''); }
  function update(field, value) { setDraft(d => ({ ...d, [field]: value })); }

  // Drops a merge field at the cursor in whichever box was used last.
  function insertField(key) {
    const token = `{{${key}}}`;
    const field = lastFocus.current === 'subject' ? 'subject' : 'body';
    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    const current = draft?.[field] || '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    update(field, next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save(e) {
    e.preventDefault();
    if (!draft.name.trim()) { setError('Give the template a name.'); return; }
    setBusy(true); setError(''); setMsg('');
    const payload = {
      name: draft.name.trim(),
      subject: draft.subject,
      body: draft.body,
      updated_at: new Date().toISOString(),
    };
    let err;
    if (draft.id) {
      ({ error: err } = await supabase.from('email_compose_templates').update(payload).eq('id', draft.id));
    } else {
      const nextSort = templates.reduce((m, t) => Math.max(m, t.sort_order || 0), 0) + 10;
      ({ error: err } = await supabase.from('email_compose_templates').insert({ ...payload, sort_order: nextSort }));
    }
    setBusy(false);
    if (err) { setError(err.message || 'Could not save the template.'); return; }
    setMsg(draft.id ? 'Template saved.' : 'Template added.');
    setDraft(null);
    await load();
  }

  async function remove(t) {
    if (!window.confirm(`Delete the template "${t.name}"?`)) return;
    setBusy(true); setError(''); setMsg('');
    const { error: err } = await supabase.from('email_compose_templates').delete().eq('id', t.id);
    setBusy(false);
    if (err) { setError(err.message || 'Could not delete the template.'); return; }
    if (draft?.id === t.id) setDraft(null);
    setMsg('Template deleted.');
    await load();
  }

  async function duplicate(t) {
    setBusy(true); setError(''); setMsg('');
    const nextSort = templates.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 10;
    const { error: err } = await supabase.from('email_compose_templates').insert({
      name: `${t.name} copy`, subject: t.subject, body: t.body, sort_order: nextSort,
    });
    setBusy(false);
    if (err) { setError(err.message || 'Could not duplicate the template.'); return; }
    setMsg('Template duplicated.');
    await load();
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= templates.length) return;
    const a = templates[index];
    const b = templates[target];
    // Give both a fresh, distinct order so equal sort values can never stall a move.
    const aOrder = (target + 1) * 10;
    const bOrder = (index + 1) * 10;
    setBusy(true); setError('');
    const [r1, r2] = await Promise.all([
      supabase.from('email_compose_templates').update({ sort_order: aOrder }).eq('id', a.id),
      supabase.from('email_compose_templates').update({ sort_order: bOrder }).eq('id', b.id),
    ]);
    setBusy(false);
    if (r1.error || r2.error) { setError((r1.error || r2.error).message || 'Could not reorder.'); return; }
    await load();
  }

  function testOpen() {
    const subject = fillTemplate(draft.subject, PREVIEW_VARS);
    const body = fillTemplate(draft.body, PREVIEW_VARS);
    const url = buildComposeUrl({ provider, to: '', subject, body });
    if (provider === 'default') window.location.href = url;
    else window.open(url, '_blank', 'noopener');
  }

  function changeProvider(v) { setProvider(v); saveProvider(v); }

  const preview = draft ? {
    subject: fillTemplate(draft.subject, PREVIEW_VARS),
    body: fillTemplate(draft.body, PREVIEW_VARS),
  } : null;

  return (
    <div className="card">
      <h3>Email templates</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        These power the Email button next to contacts, properties, companies and to-dos. Pick a template and a new
        message opens in your own email provider with the subject and body already filled in. Nothing is sent from
        here, you review and send it yourself.
      </div>

      {!loaded && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}

      {loaded && templates.map((t, i) => (
        <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{t.subject || 'No subject'}</div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" disabled={busy || i === 0} aria-label={`Move ${t.name} up`} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="btn btn-sm" disabled={busy || i === templates.length - 1} aria-label={`Move ${t.name} down`} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => startEdit(t)}>Edit</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => duplicate(t)}>Duplicate</button>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove(t)}>Delete</button>
          </div>
        </div>
      ))}

      {loaded && templates.length === 0 && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>No templates yet.</div>
      )}

      {!draft && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={startNew}>Add template</button>
        </div>
      )}

      {draft && (
        <form onSubmit={save} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>{draft.id ? 'Edit template' : 'New template'}</div>

          <label>Template name</label>
          <input value={draft.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Intro email" required />

          <label style={{ marginTop: 12 }}>Subject line</label>
          <input
            ref={subjectRef}
            value={draft.subject}
            onFocus={() => { lastFocus.current = 'subject'; }}
            onChange={e => update('subject', e.target.value)}
            placeholder="e.g. Quick introduction from McLoud Construction"
          />

          <label style={{ marginTop: 12 }}>Body</label>
          <textarea
            ref={bodyRef}
            rows={12}
            value={draft.body}
            onFocus={() => { lastFocus.current = 'body'; }}
            onChange={e => update('body', e.target.value)}
            placeholder={'Hi {{first_name}},\n\n...'}
          />

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
              Merge fields, tap to insert at the cursor. They fill in from the contact when you click Email.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MERGE_FIELDS.map(f => (
                <button key={f.key} type="button" className="btn btn-sm" title={f.hint} onClick={() => insertField(f.key)}>
                  {`{{${f.key}}}`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Preview with sample details</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{preview.subject || 'No subject'}</div>
            <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview.body || 'No body yet.'}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
            <span style={{ flex: 1 }} />
            <select value={provider} onChange={e => changeProvider(e.target.value)} style={{ maxWidth: 190, fontSize: 12.5 }} aria-label="Open test email with">
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button type="button" className="btn btn-sm" onClick={testOpen}>Test in my email</button>
          </div>
        </form>
      )}

      {msg && <div style={{ fontSize: 12.5, marginTop: 10, color: '#16a34a' }}>{msg}</div>}
      {error && <div style={{ fontSize: 12.5, marginTop: 10, color: '#dc2626' }}>{error}</div>}
    </div>
  );
}
