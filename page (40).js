'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';
import ColorField from '../../components/ColorField';
import { deriveThemeAccents } from '../../lib/deriveAccent';

const SETTINGS_TABS = ['Cosmetic', 'Dashboard', 'Integrations', 'AI Features', 'Automatic Communications'];

const AI_FEATURES = [
  { key: 'scope', name: 'Scope of Work Generation', description: 'Turns a rough job description into a customer-facing scope, plus an exhaustive trade-tagged action list on the estimating side.' },
  { key: 'receipts', name: 'Receipt Reading', description: 'Reads a photographed receipt and pre-fills vendor, amount, date, and category for you to confirm.' },
  { key: 'materials', name: 'Materials Suggestions', description: 'Drafts a starting materials list on the Estimating tool from a job\u2019s action list \u2014 always a starting point you edit, never a final answer.' },
];

const AUTOMATIONS = [
  { key: 'followups', name: 'Opportunity Follow-ups', description: 'Sends a follow-up email 2 days and 4 days after an opportunity is logged, if it\u2019s still Prospecting or Contacted.' },
  { key: 'reminders', name: 'Schedule Reminders', description: 'Emails the customer 1 week and 1 day before a job\u2019s Scheduled Start Date.' },
];

const INTEGRATIONS = [
  { key: 'quickbooks', name: 'QuickBooks', description: 'Sync invoices and payments to your books.' },
  { key: 'stripe', name: 'Payment processor (Stripe)', description: 'Accept card payments on invoices.' },
  { key: 'email', name: 'Transactional email (your SMTP server)', description: 'Auto-send estimates, contracts, and updates by email.' },
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
  const { session, loading } = useRequireAuth();
  const { settings, refresh } = useSettings();

  const [form, setForm] = useState(settings);
  const [tab, setTab] = useState('Cosmetic');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setForm(settings); }, [settings]);

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
          font_choice: form.font_choice,
          logo_size_desktop: form.logo_size_desktop,
          logo_size_mobile: form.logo_size_mobile,
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
      font_choice: 'system',
      logo_size_desktop: 180,
      logo_size_mobile: 150,
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
                  type="range" min="150" max="300" step="1"
                  value={form.logo_size_desktop ?? 180}
                  onChange={e => update('logo_size_desktop', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="150" max="300"
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
                  type="range" min="150" max="300" step="1"
                  value={form.logo_size_mobile ?? 150}
                  onChange={e => update('logo_size_mobile', parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min="150" max="300"
                  value={form.logo_size_mobile ?? 150}
                  onChange={e => update('logo_size_mobile', parseInt(e.target.value) || 150)}
                  style={{ width: 70, flexShrink: 0 }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            This updates the logo shown in the app. Estimate, contract, and update documents still use the original letterhead logo for now — let me know if you want those switched over too.
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
        <div className="card">
          <h3>Integrations</h3>
          {INTEGRATIONS.map(i => (
            <div key={i.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{i.description}</div>
              </div>
              <button className="btn btn-sm" disabled title="Coming in a later phase">Not connected</button>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 14 }}>
            These need their own accounts/credentials set up before I can wire them in.
          </div>
        </div>
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
