'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import StaffUsersPanel from '../../components/StaffUsersPanel';
import CommunicationsLogPanel from '../../components/CommunicationsLogPanel';
import BackfillPortalInvitesPanel from '../../components/BackfillPortalInvitesPanel';
import ColorField from '../../components/ColorField';
import { deriveThemeAccents } from '../../lib/deriveAccent';

const SETTINGS_TABS = ['Cosmetic', 'Dashboard', 'Integrations', 'AI Features', 'Automatic Communications', 'Communications Log', 'Users'];

const AI_FEATURES = [
  { key: 'scope', name: 'Scope of Work Generation', description: 'Turns a rough job description into a customer-facing scope, plus an exhaustive trade-tagged action list on the estimating side.' },
  { key: 'receipts', name: 'Receipt Reading', description: 'Reads a photographed receipt and pre-fills vendor, amount, date, and category for you to confirm.' },
  { key: 'materials', name: 'Materials Suggestions', description: 'Drafts a starting materials list on the Estimating tool from a job\u2019s action list \u2014 always a starting point you edit, never a final answer.' },
];

const AUTOMATIONS = [
  { key: 'followups', name: 'Opportunity Follow-ups', description: 'Sends a follow-up email 2 days and 4 days after an opportunity is logged, if it\u2019s still Prospecting or Contacted.' },
  { key: 'reminders', name: 'Schedule Reminders', description: 'Emails the customer 1 week and 1 day before a job\u2019s Scheduled Start Date.' },
];

// Google/Microsoft/QuickBooks: real OAuth — "Connect" opens the
// provider's login screen. Google & Microsoft power two-way calendar
// sync; QuickBooks powers invoice sync.
const OAUTH_INTEGRATIONS = [
  { key: 'google', name: 'Google Calendar', description: 'Two-way sync: job schedules push to your Google Calendar, and your personal events show as busy time on the job calendar.' },
  { key: 'microsoft', name: 'Microsoft Calendar', description: 'Two-way sync: job schedules push to your Outlook/Microsoft 365 calendar, and your personal events show as busy time on the job calendar.' },
  { key: 'quickbooks', name: 'QuickBooks Online', description: 'Log in to your QBO account to sync invoices and payments to your books.' },
];

// Resend/Weather: no login — just an API key pasted in below.
const KEY_INTEGRATIONS = [
  { key: 'resend', name: 'Resend (email)', description: 'Auto-send estimates, contracts, and updates by email through your Resend account. Falls back to your SMTP server if not set up.', fields: [] },
  { key: 'weather', name: 'Weather', description: 'Powers weather lookups in the app, via OpenWeatherMap.', fields: [{ key: 'zip', label: 'Default zip code', placeholder: '64111' }] },
  { key: 'unsplash', name: 'Image search (materials)', description: 'Powers the "search for a photo" option in the Estimate material picture chooser, via Unsplash.', fields: [] },
];

const FONT_OPTIONS = [
  { value: 'system', label: 'System sans-serif (default)' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'rounded', label: 'Rounded sans-serif' },
];

const DASHBOARD_WIDGETS = [
  { key: 'sold_job_count', label: 'Sold Job Count Total' },
  { key: 'job_counts_by_stage', label: 'Job Counts by Stage' },
  { key: 'overdue_opportunities', label: 'Overdue Opportunities' },
  { key: 'total_ar', label: 'Total AR Dollars' },
  { key: 'total_paid', label: 'Total Paid Dollars' },
  { key: 'revenue_ytd', label: 'Total Revenue YTD' },
  { key: 'revenue_mtd', label: 'Total Revenue MTD' },
  { key: 'total_profit', label: 'Total Profit Dollars' },
  { key: 'sales_route_ai', label: 'Create My Sales Route' },
  { key: 'new_opportunity_button', label: 'New Opportunity Button' },
];


export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { session, loading } = useRequireAuth();
  const { settings, refresh } = useSettings();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState(settings);
  const [tab, setTab] = useState('Cosmetic');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const [integrationStatus, setIntegrationStatus] = useState(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [connecting, setConnecting] = useState(null); // provider key currently redirecting
  const [keyInputs, setKeyInputs] = useState({ resend: '', weather: '' });
  const [zipInput, setZipInput] = useState('');
  const [savingCred, setSavingCred] = useState(null);
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => { setForm(settings); }, [settings]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data?.session?.access_token}` };
  }

  async function loadIntegrationStatus() {
    setIntegrationsLoading(true);
    try {
      const res = await fetch('/api/integrations/status', { headers: await authHeader() });
      const data = await res.json();
      if (res.ok) setIntegrationStatus(data);
      else setError(data.error || 'Failed to load integration status.');
    } catch (err) {
      setError(err.message);
    } finally {
      setIntegrationsLoading(false);
    }
  }

  // Land here from an OAuth callback redirect (?connected=google or
  // ?error=google:...) — surface it once, then clean the URL.
  useEffect(() => {
    if (tab !== 'Integrations') return;
    loadIntegrationStatus();
    const connected = searchParams.get('connected');
    const err = searchParams.get('error');
    if (connected) showFlash(`Connected to ${connected}.`);
    if (err) setError(err);
    if (connected || err) router.replace('/settings?tab=Integrations');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function connectProvider(provider) {
    setConnecting(provider);
    setError('');
    try {
      const res = await fetch(`/api/integrations/${provider}/connect`, { method: 'POST', headers: await authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start connection.');
      window.location.href = data.url; // full-page redirect to the provider's login
    } catch (err) {
      setError(err.message);
      setConnecting(null);
    }
  }

  async function disconnectProvider(provider) {
    if (!confirm(`Disconnect ${provider}?`)) return;
    setError('');
    try {
      const res = await fetch('/api/integrations/disconnect', { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect.');
      showFlash(`${provider} disconnected`);
      loadIntegrationStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveCredential(provider) {
    const apiKey = keyInputs[provider];
    if (!apiKey || !apiKey.trim()) { setError('Enter an API key first.'); return; }
    setSavingCred(provider);
    setError('');
    try {
      const config = provider === 'weather' && zipInput ? { zip: zipInput } : {};
      const res = await fetch('/api/integrations/credentials', {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save key.');
      showFlash(`${provider} key saved`);
      setKeyInputs(prev => ({ ...prev, [provider]: '' }));
      loadIntegrationStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCred(null);
    }
  }

  async function removeCredential(provider) {
    if (!confirm(`Remove the saved ${provider} key?`)) return;
    setError('');
    try {
      const res = await fetch('/api/integrations/credentials', { method: 'DELETE', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove key.');
      showFlash(`${provider} key removed`);
      loadIntegrationStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function syncCalendarNow() {
    setSyncingNow(true);
    setError('');
    try {
      const res = await fetch('/api/integrations/calendar-sync-now', { method: 'POST', headers: await authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed.');
      const total = (data.results || []).reduce((sum, r) => sum + (r.pushed || 0) + (r.pulled || 0), 0);
      showFlash(`Synced — ${total} events updated`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncingNow(false);
    }
  }

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function toggleWidget(key) {
    setForm(prev => {
      const widgets = { ...(prev.dashboard_widgets || {}) };
      const currentlyOn = widgets[key] !== false;
      widgets[key] = !currentlyOn;
      return { ...prev, dashboard_widgets: widgets };
    });
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2000);
  }

  async function handleLogoUpload(e, field = 'logo_url') {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setUploading(true);

    try {
      const ext = file.name.split('.').pop();
      const prefix = field === 'watermark_logo_url' ? 'watermark' : 'logo';
      const path = `${prefix}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('branding').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path);
      const { error: updateError } = await supabase.from('app_settings').update({ [field]: urlData.publicUrl }).eq('id', 1);
      if (updateError) throw updateError;

      showFlash(field === 'watermark_logo_url' ? 'Watermark logo updated' : 'Logo updated');
      refresh();
    } catch (err) {
      setError(err.message || 'Upload failed. Make sure migration 003 (storage bucket) has been run in Supabase.');
    } finally {
      setUploading(false);
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('app_settings')
        .update({
          brand_color: form.brand_color,
          header_text_color: form.header_text_color,
          font_choice: form.font_choice,
          logo_size_desktop: form.logo_size_desktop,
          logo_size_mobile: form.logo_size_mobile,
          portal_logo_size_desktop: form.portal_logo_size_desktop,
          portal_logo_size_mobile: form.portal_logo_size_mobile,
          signout_bg: form.signout_bg,
          signout_text: form.signout_text,
          signout_hover_bg: form.signout_hover_bg,
          dashboard_widgets: form.dashboard_widgets,
        })
        .eq('id', 1);
      if (updateError) throw updateError;
      showFlash('Settings saved');
      refresh();
    } catch (err) {
      setError(err.message || 'Save failed. Make sure migration 004 has been run in Supabase.');
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    setForm(prev => ({
      ...prev,
      brand_color: '#9b773d',
      header_text_color: null,
      font_choice: 'system',
      logo_size_desktop: 180,
      logo_size_mobile: 150,
      portal_logo_size_desktop: 96,
      portal_logo_size_mobile: 64,
      signout_bg: 'transparent',
      signout_text: '#49402a',
      signout_hover_bg: '#302a1a',
    }));
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Settings</h2>
          {flash && <span className="saved-flash">{flash}</span>}
        </div>
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="stage-tabs">
          {SETTINGS_TABS.map(t => (
            <button key={t} className={`stage-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Cosmetic' && (
        <>
        <div className="card">
          <h3>Logo</h3>
          {settings.logo_url && (
            <div style={{ marginBottom: 14 }}>
              <img src={settings.logo_url} alt="Current logo" style={{ maxWidth: 220, height: 'auto', display: 'block' }} />
            </div>
          )}
          <label htmlFor="logoUpload">Upload a new logo (PNG or SVG, transparent background works best)</label>
          <input id="logoUpload" type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={handleLogoUpload} disabled={uploading} />
          {uploading && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>Uploading…</div>}

          <div className="two-col" style={{ marginTop: 16 }}>
            <div>
              <label>Logo height on desktop (px)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range" min="50" max="200" step="1"
                  value={form.logo_size_desktop ?? 180}
                  onChange={e => update('logo_size_desktop', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="50" max="200"
                  value={form.logo_size_desktop ?? 180}
                  onChange={e => update('logo_size_desktop', parseInt(e.target.value) || 150)}
                  style={{ width: 70, flexShrink: 0 }}
                />
              </div>
            </div>
            <div>
              <label>Logo height on mobile (px)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range" min="50" max="200" step="1"
                  value={form.logo_size_mobile ?? 150}
                  onChange={e => update('logo_size_mobile', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="50" max="200"
                  value={form.logo_size_mobile ?? 150}
                  onChange={e => update('logo_size_mobile', parseInt(e.target.value) || 150)}
                  style={{ width: 70, flexShrink: 0 }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            This size applies to the main app (staff sidebar/topbar) only. The customer and subcontractor portals have their own size below, since their header has a lot more room than the staff sidebar does.
          </div>

          <div className="two-col" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div>
              <label>Portal logo height on desktop (px)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range" min="24" max="120" step="1"
                  value={form.portal_logo_size_desktop ?? 96}
                  onChange={e => update('portal_logo_size_desktop', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="24" max="120"
                  value={form.portal_logo_size_desktop ?? 96}
                  onChange={e => update('portal_logo_size_desktop', parseInt(e.target.value) || 96)}
                  style={{ width: 70, flexShrink: 0 }}
                />
              </div>
            </div>
            <div>
              <label>Portal logo height on mobile (px)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range" min="24" max="120" step="1"
                  value={form.portal_logo_size_mobile ?? 64}
                  onChange={e => update('portal_logo_size_mobile', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="24" max="120"
                  value={form.portal_logo_size_mobile ?? 64}
                  onChange={e => update('portal_logo_size_mobile', parseInt(e.target.value) || 64)}
                  style={{ width: 70, flexShrink: 0 }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            Controls the logo size on the customer portal (jobs.mcloudconstruction.com/customerportal) and subcontractor portal (/sub-portal) headers.
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            The logo image itself is also used on every generated document — estimates, contracts, invoices, change orders, work orders, and updates all pull from this same uploaded logo.
          </div>
        </div>

        <div className="card">
          <h3>Photo watermark</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
            Stamped onto every photo you upload. Leave this empty to use your main logo above instead.
          </div>
          {settings.watermark_logo_url && (
            <div style={{ marginBottom: 14 }}>
              <img src={settings.watermark_logo_url} alt="Current watermark logo" style={{ maxWidth: 220, height: 'auto', display: 'block' }} />
            </div>
          )}
          <label htmlFor="watermarkUpload">Upload a watermark logo (PNG with transparent background recommended)</label>
          <input id="watermarkUpload" type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={e => handleLogoUpload(e, 'watermark_logo_url')} disabled={uploading} />
          {settings.watermark_logo_url && (
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={async () => { await supabase.from('app_settings').update({ watermark_logo_url: null }).eq('id', 1); refresh(); }}
            >
              Use main logo instead
            </button>
          )}
        </div>

        <div className="card">
          <h3>Brand Accent Color</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
            Page layout, backgrounds, and sidebar now follow Light/Dark mode automatically (toggle at the bottom of the sidebar). Enter one brand color here — buttons, links, and highlights are derived from it automatically, adjusted separately for each mode so it always stays legible.
          </div>
          <ColorField label="Brand color" id="brandColor" value={form.brand_color} fallback="#8a3d14" onChange={v => update('brand_color', v)} />
          <BrandColorPreview hex={form.brand_color} />

          <label htmlFor="fontChoice" style={{ marginTop: 16 }}>Font</label>
          <select id="fontChoice" value={form.font_choice || 'system'} onChange={e => update('font_choice', e.target.value)}>
            {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        <div className="card">
          <h3>Header Text Color</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
            The header bar itself is always dark chrome in both Light and Dark mode, by design — this only controls the text and icon color on top of it. It's separate from the brand color above, which only drives buttons and accents.
          </div>
          <ColorField label="Header text color" id="headerTextColor" value={form.header_text_color || '#f0ede8'} fallback="#f0ede8" onChange={v => update('header_text_color', v)} />
          {form.header_text_color && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => update('header_text_color', null)}>
              Use default
            </button>
          )}
        </div>

        </>
        )}

        {tab === 'Dashboard' && (
        <div className="card">
          <h3>Main Dashboard widgets</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
            Choose what shows up on your Dashboard page.
          </div>
          {DASHBOARD_WIDGETS.map(w => (
            <label key={w.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={(form.dashboard_widgets || {})[w.key] !== false}
                onChange={() => toggleWidget(w.key)}
              />
              {w.label}
            </label>
          ))}
        </div>
        )}

        <div className="section-actions" style={{ marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save all settings'}</button>
          <button className="btn" onClick={resetToDefault}>Reset colors to default</button>
        </div>

        {tab === 'Integrations' && (
        <>
        <div className="card">
          <h3>Log in &amp; connect</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
            Each of these needs a one-time developer app registration before "Connect" will work — see INTEGRATIONS_SETUP.md in the repo for exact steps and the env vars to add in Vercel.
          </div>
          {OAUTH_INTEGRATIONS.map(i => {
            const status = integrationStatus?.[i.key];
            return (
              <div key={i.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{i.description}</div>
                  {status?.connected && (
                    <div style={{ fontSize: 11.5, color: 'var(--accent, #2e7d32)', marginTop: 4 }}>Connected{status.label ? ` — ${status.label}` : ''}</div>
                  )}
                </div>
                {status?.connected ? (
                  <button className="btn btn-sm" onClick={() => disconnectProvider(i.key)}>Disconnect</button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={connecting === i.key} onClick={() => connectProvider(i.key)}>
                    {connecting === i.key ? 'Redirecting…' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
          {(integrationStatus?.google?.connected || integrationStatus?.microsoft?.connected) && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-sm" onClick={syncCalendarNow} disabled={syncingNow}>{syncingNow ? 'Syncing…' : 'Sync calendar now'}</button>
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Also runs automatically every 2 hours.</span>
            </div>
          )}
          {integrationsLoading && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>Loading…</div>}
        </div>

        <div className="card">
          <h3>API keys</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
            These don't need a login — just an API key from the provider's dashboard.
          </div>
          {KEY_INTEGRATIONS.map(i => {
            const status = integrationStatus?.[i.key];
            return (
              <div key={i.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{i.description}</div>
                    {status?.connected && <div style={{ fontSize: 11.5, color: 'var(--accent, #2e7d32)', marginTop: 4 }}>Key saved</div>}
                  </div>
                  {status?.connected && (
                    <button className="btn btn-sm" onClick={() => removeCredential(i.key)}>Remove</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    placeholder={status?.connected ? 'Enter a new key to replace it' : 'API key'}
                    style={{ maxWidth: 260 }}
                    value={keyInputs[i.key] || ''}
                    onChange={e => setKeyInputs(prev => ({ ...prev, [i.key]: e.target.value }))}
                  />
                  {i.fields.map(f => (
                    <input
                      key={f.key}
                      placeholder={f.placeholder}
                      style={{ maxWidth: 140 }}
                      value={zipInput}
                      onChange={e => setZipInput(e.target.value)}
                    />
                  ))}
                  <button className="btn btn-sm" disabled={savingCred === i.key} onClick={() => saveCredential(i.key)}>
                    {savingCred === i.key ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}

        {tab === 'AI Features' && (
        <div className="card">
          <h3>AI Features</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Powered by your Anthropic API key (set in Vercel as ANTHROPIC_API_KEY) — there's nothing to configure here, this is just what's active.
          </div>
          {AI_FEATURES.map(f => (
            <div key={f.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{f.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{f.description}</div>
            </div>
          ))}
        </div>
        )}

        {tab === 'Automatic Communications' && (
        <div className="card">
          <h3>Automatic Communications</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Runs once daily on a schedule — there's no on/off switch here, but any individual contact can be excluded from the Automated Notifications section on their contact card.
          </div>
          {AUTOMATIONS.map(a => (
            <div key={a.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{a.description}</div>
            </div>
          ))}
        </div>
        )}

        {tab === 'Communications Log' && (
          <>
            <BackfillPortalInvitesPanel />
            <div className="card">
              <h3>Communications Log</h3>
              <CommunicationsLogPanel />
            </div>
          </>
        )}

        {tab === 'Users' && <StaffUsersPanel session={session} />}
      </div>
    </AppShell>
  );
}

function BrandColorPreview({ hex }) {
  const derived = deriveThemeAccents(hex);
  if (!derived) return null;
  return (
    <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
      <div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 6 }}>On light mode</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 60, height: 34, borderRadius: 5, background: derived.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</div>
          <div style={{ width: 60, height: 34, borderRadius: 5, background: derived.accentLightHover, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>hover</div>
        </div>
      </div>
      <div style={{ background: '#1a1a1d', padding: '8px 10px', borderRadius: 6 }}>
        <div style={{ fontSize: 10.5, color: '#9a968f', marginBottom: 6 }}>On dark mode</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 60, height: 34, borderRadius: 5, background: derived.accentDark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</div>
          <div style={{ width: 60, height: 34, borderRadius: 5, background: derived.accentDarkHover, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>hover</div>
        </div>
      </div>
    </div>
  );
}
