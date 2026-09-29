'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { COMPLIANCE_DOC_TYPES, ENFORCEMENT_MODES } from '../lib/compliance';
import { WAIVER_ENFORCEMENT_MODES } from '../lib/lienWaivers';

// Settings for the newer workflow features (compliance vault, lien waivers,
// reviews, warranty). Kept out of the main Settings form on purpose: each
// section here loads and saves its own app_settings columns with its own
// button, so adding a setting never means threading it through the big
// saveAll() on the Settings page. Owner-only, because the Settings page is.

function useSection(fields) {
  const [values, setValues] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('app_settings').select(fields.join(',')).eq('id', 1).maybeSingle();
    if (err) { setError(`${err.message} — make sure the latest migrations have been run.`); return; }
    setValues(data || {});
    setSaved(data || {});
  }, [fields]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    setError('');
    const patch = {};
    fields.forEach(f => { patch[f] = values[f]; });
    const { error: err } = await supabase.from('app_settings').update(patch).eq('id', 1);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSaved(values);
    setFlash('Saved');
    setTimeout(() => setFlash(''), 2500);
  }

  const dirty = values && saved && JSON.stringify(values) !== JSON.stringify(saved);
  return { values, set: (k, v) => setValues(prev => ({ ...prev, [k]: v })), save, busy, error, flash, dirty };
}

function SectionShell({ title, intro, section, children }) {
  return (
    <div className="dash-section" style={{ marginTop: 18 }}>
      <h3>{title}</h3>
      {intro && <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', maxWidth: 640 }}>{intro}</div>}
      {!section.values && !section.error && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</div>}
      {section.error && <div className="error-text">{section.error}</div>}
      {section.values && (
        <>
          {children}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={section.save} disabled={section.busy || !section.dirty}>{section.busy ? 'Saving…' : 'Save'}</button>
            {section.flash && <span style={{ fontSize: 12, color: '#3a6b45', marginLeft: 10 }}>{section.flash}</span>}
          </div>
        </>
      )}
    </div>
  );
}

const COMPLIANCE_FIELDS = ['compliance_required_types', 'compliance_enforcement', 'compliance_expiring_days', 'compliance_min_gl_amount'];

function ComplianceSettings() {
  const s = useSection(COMPLIANCE_FIELDS);
  const v = s.values || {};
  const required = v.compliance_required_types || [];

  function toggle(key) {
    s.set('compliance_required_types', required.includes(key) ? required.filter(k => k !== key) : [...required, key]);
  }

  return (
    <SectionShell
      title="Subcontractor compliance"
      intro="Which documents every subcontractor must keep on file, how early to warn about expirations, and what happens when a sub isn't compliant. You can override the list for an individual company from its Compliance panel."
      section={s}
    >
      <label>Required documents (all subcontractors)</label>
      <div style={{ marginBottom: 12 }}>
        {COMPLIANCE_DOC_TYPES.filter(t => t.key !== 'other').map(t => (
          <label key={t.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={required.includes(t.key)} onChange={() => toggle(t.key)} />
            {t.label}
          </label>
        ))}
      </div>

      <div className="two-col">
        <div>
          <label>Start warning this many days before expiry</label>
          <input type="number" min="1" max="120" value={v.compliance_expiring_days ?? 30} onChange={e => s.set('compliance_expiring_days', Number(e.target.value) || 30)} />
        </div>
        <div>
          <label>Minimum General Liability coverage ($, optional)</label>
          <input inputMode="decimal" value={v.compliance_min_gl_amount ?? ''} placeholder="No minimum" onChange={e => s.set('compliance_min_gl_amount', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
      </div>

      <label style={{ marginTop: 12 }}>When a sub isn&apos;t compliant</label>
      {ENFORCEMENT_MODES.map(m => (
        <label key={m.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontWeight: 400, cursor: 'pointer', marginBottom: 4 }}>
          <input type="radio" name="compliance_enforcement" style={{ width: 'auto', marginTop: 3 }} checked={v.compliance_enforcement === m.key} onChange={() => s.set('compliance_enforcement', m.key)} />
          <span>{m.label}</span>
        </label>
      ))}
    </SectionShell>
  );
}

const WAIVER_FIELDS = ['company_legal_name', 'default_retainage_percent', 'waiver_enforcement', 'waiver_auto_unconditional', 'waiver_due_days'];

function WaiverSettings() {
  const s = useSection(WAIVER_FIELDS);
  const v = s.values || {};
  return (
    <SectionShell
      title="Lien waivers & pay applications"
      intro="The legal name printed on every waiver, the retainage new pay applications start with, and whether a sub can be paid without a signed waiver. The waiver wording is generic and has not been reviewed by an attorney — have a Missouri construction attorney check it before you rely on it."
      section={s}
    >
      <div className="two-col">
        <div>
          <label>Legal company name (printed on waivers)</label>
          <input value={v.company_legal_name ?? ''} onChange={e => s.set('company_legal_name', e.target.value)} />
        </div>
        <div>
          <label>Default retainage on new pay applications (%)</label>
          <input inputMode="decimal" value={v.default_retainage_percent ?? ''} onChange={e => s.set('default_retainage_percent', e.target.value === '' ? 0 : Number(e.target.value))} />
        </div>
        <div>
          <label>Days a sub has to sign a waiver</label>
          <input type="number" min="1" max="60" value={v.waiver_due_days ?? 5} onChange={e => s.set('waiver_due_days', Number(e.target.value) || 5)} />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', margin: '12px 0' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={v.waiver_auto_unconditional !== false} onChange={e => s.set('waiver_auto_unconditional', e.target.checked)} />
        When a sub who signed a conditional waiver is marked paid, automatically request the matching unconditional waiver
      </label>
      <label>Paying a sub without a signed waiver</label>
      {WAIVER_ENFORCEMENT_MODES.map(m => (
        <label key={m.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontWeight: 400, cursor: 'pointer', marginBottom: 4 }}>
          <input type="radio" name="waiver_enforcement" style={{ width: 'auto', marginTop: 3 }} checked={v.waiver_enforcement === m.key} onChange={() => s.set('waiver_enforcement', m.key)} />
          <span>{m.label}</span>
        </label>
      ))}
    </SectionShell>
  );
}

const WARRANTY_FIELDS = ['warranty_default_months', 'warranty_auto_create'];

function WarrantySettings() {
  const s = useSection(WARRANTY_FIELDS);
  const v = s.values || {};
  return (
    <SectionShell
      title="Warranty"
      intro="A warranty period is created automatically when a job is marked Completed. Customers can file claims from their portal while it's active. Only jobs completed from now on get one — older jobs aren't touched (you can start one by hand from a job's Closeout tab)."
      section={s}
    >
      <div className="two-col">
        <div>
          <label>Default warranty length (months)</label>
          <input type="number" min="0" max="120" value={v.warranty_default_months ?? 12} onChange={e => s.set('warranty_default_months', Math.max(0, Number(e.target.value) || 0))} />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', marginTop: 10 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={v.warranty_auto_create !== false} onChange={e => s.set('warranty_auto_create', e.target.checked)} />
        Start a warranty automatically when a job is completed
      </label>
    </SectionShell>
  );
}

const REVIEW_FIELDS = ['review_auto_request', 'review_request_delay_days', 'review_reminder_days', 'review_google_min_rating', 'review_hold_if_open_punch', 'review_hold_if_unpaid', 'review_max_hold_days', 'review_google_url'];

function ReviewSettings() {
  const s = useSection(REVIEW_FIELDS);
  const v = s.values || {};
  const num = (k, min, max) => e => s.set(k, Math.min(max, Math.max(min, Number(e.target.value) || 0)));
  return (
    <SectionShell
      title="Customer reviews"
      intro="Every completed job gets a private review request. Reviews always come to you first; the Google link is only offered afterwards, to customers who rated you at or above the threshold below. Only jobs completed from now on are included — past customers are never emailed."
      section={s}
    >
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={v.review_auto_request !== false} onChange={e => s.set('review_auto_request', e.target.checked)} />
        Send review requests automatically
      </label>
      <div className="two-col">
        <div>
          <label>Days after completion</label>
          <input type="number" min="0" max="60" value={v.review_request_delay_days ?? 3} onChange={num('review_request_delay_days', 0, 60)} />
        </div>
        <div>
          <label>Reminder after (days, 0 = none)</label>
          <input type="number" min="0" max="60" value={v.review_reminder_days ?? 5} onChange={num('review_reminder_days', 0, 60)} />
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 10 }}>
        <div>
          <label>Offer Google when the rating is at least</label>
          <select value={v.review_google_min_rating ?? 4} onChange={e => s.set('review_google_min_rating', Number(e.target.value))}>
            <option value={5}>5 stars</option>
            <option value={4}>4 stars (recommended)</option>
            <option value={3}>3 stars</option>
            <option value={1}>Everyone</option>
          </select>
        </div>
        <div>
          <label>Stop holding after (days)</label>
          <input type="number" min="1" max="365" value={v.review_max_hold_days ?? 45} onChange={num('review_max_hold_days', 1, 365)} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Google review link</label>
        <input value={v.review_google_url || ''} placeholder="Leave blank to use the built-in link" onChange={e => s.set('review_google_url', e.target.value)} />
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', marginTop: 12 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={v.review_hold_if_open_punch !== false} onChange={e => s.set('review_hold_if_open_punch', e.target.checked)} />
        Wait while punch list or warranty items are still open
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', marginTop: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={!!v.review_hold_if_unpaid} onChange={e => s.set('review_hold_if_unpaid', e.target.checked)} />
        Wait until the job is paid
      </label>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 12, maxWidth: 640, lineHeight: 1.55 }}>
        Requests also wait automatically when the customer has an unanswered message or has opted out of automated emails. A heads-up: Google&rsquo;s policy discourages selectively asking only happy customers for reviews, and the FTC treats suppressing negative reviews as deceptive. Choosing &ldquo;Everyone&rdquo; is the safest setting; the default only decides who sees the Google button after they&rsquo;ve already given you feedback here. Every review you receive here is counted in the rating shown on your website, whether or not you publish it.
      </div>
    </SectionShell>
  );
}

function AiSandboxSettings() {
  const [status, setStatus] = useState(null);
  const [textProvider, setTextProvider] = useState('anthropic');
  const [textModel, setTextModel] = useState('');
  const [textKeyInput, setTextKeyInput] = useState('');
  const [transcriptionKeyInput, setTranscriptionKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('ai_provider_settings').select('*').eq('id', 1).maybeSingle();
    if (err) { setError(`${err.message} — make sure migration 140 has been run.`); return; }
    setStatus(data || null);
    if (data) { setTextProvider(data.text_provider); setTextModel(data.text_model || ''); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveProviderChoice() {
    setBusy(true); setError('');
    const { error: err } = await supabase.from('ai_provider_settings').update({ text_provider: textProvider, text_model: textModel || null }).eq('id', 1);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setFlash('Saved'); setTimeout(() => setFlash(''), 2000); load();
  }

  async function saveKey(kind) {
    const value = kind === 'text' ? textKeyInput : transcriptionKeyInput;
    if (!value.trim()) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('set_ai_api_key', { p_kind: kind, p_api_key: value.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (kind === 'text') setTextKeyInput(''); else setTranscriptionKeyInput('');
    setFlash('Key saved'); setTimeout(() => setFlash(''), 2000); load();
  }

  async function clearKey(kind) {
    if (!window.confirm('Remove this key? AI features using it will fall back to the environment variable, if one is set.')) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('clear_ai_api_key', { p_kind: kind });
    setBusy(false);
    if (err) { setError(err.message); return; }
    load();
  }

  return (
    <div className="dash-section" style={{ marginTop: 18 }}>
      <h3>AI provider (sandbox)</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', maxWidth: 640, lineHeight: 1.55 }}>
        Every AI feature in the app goes through this one setting. Leave it blank to keep using the ANTHROPIC_API_KEY set in Vercel — pasting a key here is optional today, and is what a future customer of this platform would do with their own key instead of yours.
      </div>
      {!status && !error && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</div>}
      {error && <div className="error-text">{error}</div>}
      {status && (
        <>
          <div className="two-col">
            <div>
              <label>Text drafting provider</label>
              <select value={textProvider} onChange={e => setTextProvider(e.target.value)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label>Model override (optional)</label>
              <input value={textModel} onChange={e => setTextModel(e.target.value)} placeholder="leave blank for the default" />
            </div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={saveProviderChoice} disabled={busy}>Save provider choice</button>
            {flash && <span style={{ fontSize: 12, color: '#3a6b45', marginLeft: 10 }}>{flash}</span>}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <label>{textProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key {status.has_text_key ? '— a key is on file' : '(using the environment variable)'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={textKeyInput} onChange={e => setTextKeyInput(e.target.value)} placeholder="Paste an API key" style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => saveKey('text')} disabled={busy || !textKeyInput.trim()}>Save key</button>
              {status.has_text_key && <button className="btn btn-sm" onClick={() => clearKey('text')} disabled={busy}>Remove</button>}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label>Voice transcription (OpenAI Whisper) key {status.has_transcription_key ? '— a key is on file' : '(using the environment variable)'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={transcriptionKeyInput} onChange={e => setTranscriptionKeyInput(e.target.value)} placeholder="Paste an OpenAI API key" style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => saveKey('transcription')} disabled={busy || !transcriptionKeyInput.trim()}>Save key</button>
              {status.has_transcription_key && <button className="btn btn-sm" onClick={() => clearKey('transcription')} disabled={busy}>Remove</button>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
              Voice-to-scope always transcribes through OpenAI's Whisper, even when Claude drafts the text — Claude doesn't take audio input directly.
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 12 }}>
            Keys are encrypted before they're stored and are never shown again once saved. If this is the first key saved on this platform, an encryption passphrase must be set once in the SQL editor first — see the comment at the top of migration 140.
          </div>
        </>
      )}
    </div>
  );
}

export default function FeatureSettingsPanels() {
  return (
    <>
      <ComplianceSettings />
      <WaiverSettings />
      <WarrantySettings />
      <ReviewSettings />
      <AiSandboxSettings />
    </>
  );
}

export { useSection, SectionShell };
