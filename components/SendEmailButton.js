'use client';
import { useEffect, useRef, useState } from 'react';
import { useStaffAuth } from '../lib/staffAuthContext';
import {
  PROVIDERS, listComposeTemplates, fillTemplate, firstNameOf, openCompose,
  getSavedProvider, saveProvider, LONG_DRAFT_WARNING_LENGTH,
} from '../lib/composeTemplates';

// "Email" button with a template picker. Choosing a template opens a new
// message in the person's own email provider with the recipient, subject and
// body already filled in. Nothing is sent from the app.
//
// Props:
//   to       recipient email address (required, button hides without it)
//   name     contact full name, fills {{first_name}} and {{full_name}}
//   company  fills {{company}}
//   property fills {{property}}
//   label    button text (default "Email")
//
// Templates load when the menu first opens, and the click that opens the
// draft is synchronous so popup blockers never interfere.
export default function SendEmailButton({ to, name = '', company = '', property = '', label = 'Email', small = true }) {
  const { fullName } = useStaffAuth() || {};
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [provider, setProvider] = useState('default');
  const [notice, setNotice] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => { setProvider(getSavedProvider()); }, []);

  useEffect(() => {
    if (!open || templates) return;
    let cancelled = false;
    listComposeTemplates()
      .then(rows => { if (!cancelled) setTemplates(rows); })
      .catch(() => { if (!cancelled) { setTemplates([]); setLoadError('Could not load templates. Run migration 155 in Supabase first.'); } });
    return () => { cancelled = true; };
  }, [open, templates]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const address = (to || '').trim();
  if (!address) return null;

  const vars = {
    first_name: firstNameOf(name),
    full_name: (name || '').trim(),
    company: (company || '').trim(),
    property: (property || '').trim(),
    sender_name: (fullName || '').trim(),
  };

  function launch(template) {
    const subject = template ? fillTemplate(template.subject, vars) : '';
    const body = template ? fillTemplate(template.body, vars) : '';
    const length = openCompose({ provider, to: address, subject, body });
    setNotice(length > LONG_DRAFT_WARNING_LENGTH
      ? 'This draft is long, so some mail apps may trim it. Check the body once it opens.'
      : '');
    setOpen(false);
  }

  function changeProvider(value) {
    setProvider(value);
    saveProvider(value);
  }

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`btn ${small ? 'btn-sm' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Email ${name || address}`}
        onClick={() => setOpen(o => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', right: 0, minWidth: 250, maxWidth: 'min(340px, 86vw)',
            background: 'var(--card, #fff)', border: '1px solid var(--line)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 6, textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', padding: '4px 8px 6px' }}>
            To: {address}
          </div>
          {templates === null && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '6px 8px' }}>Loading templates…</div>}
          {loadError && <div style={{ fontSize: 12, color: '#a13f3f', padding: '6px 8px' }}>{loadError}</div>}
          {(templates || []).map(t => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className="btn btn-sm"
              onClick={() => launch(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
            >
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              {t.subject && (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
              )}
            </button>
          ))}
          {templates && templates.length === 0 && !loadError && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '4px 8px 8px' }}>
              No templates yet. Add some under Settings, Email Templates.
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className="btn btn-sm"
            onClick={() => launch(null)}
            style={{ display: 'block', width: '100%', textAlign: 'left' }}
          >
            Blank email
          </button>
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6, padding: '6px 8px 4px' }}>
            <label style={{ fontSize: 11, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>Open with</label>
            <select value={provider} onChange={e => changeProvider(e.target.value)} style={{ fontSize: 12.5 }}>
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      )}
      {notice && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>{notice}</span>}
    </span>
  );
}
