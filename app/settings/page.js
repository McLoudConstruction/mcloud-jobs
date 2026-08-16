'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';
import AppShell from '../../components/AppShell';

const INTEGRATIONS = [
  { key: 'quickbooks', name: 'QuickBooks', description: 'Sync invoices and payments to your books.' },
  { key: 'stripe', name: 'Payment processor (Stripe)', description: 'Accept card payments on invoices.' },
  { key: 'email', name: 'Transactional email (your SMTP server)', description: 'Auto-send proposals, contracts, and updates by email.' },
];

const FONT_OPTIONS = [
  { value: 'system', label: 'System sans-serif (default)' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'rounded', label: 'Rounded sans-serif' },
];

function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export default function SettingsPage() {
  const { session, loading } = useRequireAuth();
  const { settings, refresh } = useSettings();

  const [form, setForm] = useState(settings);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setForm(settings); }, [settings]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2000);
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setUploading(true);

    try {
      const ext = file.name.split('.').pop();
      const path = `logo-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('branding').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path);
      const { error: updateError } = await supabase.from('app_settings').update({ logo_url: urlData.publicUrl }).eq('id', 1);
      if (updateError) throw updateError;

      showFlash('Logo updated');
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
          color_bg: form.color_bg,
          color_heading: form.color_heading,
          color_accent: form.color_accent,
          color_panel: form.color_panel,
          font_choice: form.font_choice,
          logo_size_desktop: form.logo_size_desktop,
          logo_size_mobile: form.logo_size_mobile,
          signout_bg: form.signout_bg,
          signout_text: form.signout_text,
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
      color_bg: '#dbd8bf',
      color_heading: '#49402a',
      color_accent: '#8a3d14',
      color_panel: '#d3d0b5',
      font_choice: 'system',
      logo_size_desktop: 180,
      logo_size_mobile: 120,
      signout_bg: 'transparent',
      signout_text: '#49402a',
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
              <input type="number" value={form.logo_size_desktop ?? 180} onChange={e => update('logo_size_desktop', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label>Logo height on mobile (px)</label>
              <input type="number" value={form.logo_size_mobile ?? 120} onChange={e => update('logo_size_mobile', parseInt(e.target.value) || 0)} />
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            This updates the logo shown in the app. Proposal, contract, and update documents still use the original letterhead logo for now — let me know if you want those switched over too.
          </div>
        </div>

        <div className="card">
          <h3>Color theme</h3>
          <div className="two-col">
            <div>
              <label htmlFor="colorBg">Background</label>
              <input id="colorBg" type="color" value={safeColor(form.color_bg, "#dbd8bf")} onChange={e => update('color_bg', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="colorPanel">Sidebar / panel background</label>
              <input id="colorPanel" type="color" value={safeColor(form.color_panel, "#d3d0b5")} onChange={e => update('color_panel', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="colorHeading">Headings &amp; text</label>
              <input id="colorHeading" type="color" value={safeColor(form.color_heading, "#49402a")} onChange={e => update('color_heading', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="colorAccent">Accent (buttons, badges)</label>
              <input id="colorAccent" type="color" value={safeColor(form.color_accent, "#8a3d14")} onChange={e => update('color_accent', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
          </div>

          <label htmlFor="fontChoice" style={{ marginTop: 16 }}>Font</label>
          <select id="fontChoice" value={form.font_choice || 'system'} onChange={e => update('font_choice', e.target.value)}>
            {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        <div className="card">
          <h3>Sign-out button</h3>
          <div className="two-col">
            <div>
              <label htmlFor="signoutBg">Background</label>
              <input id="signoutBg" type="color" value={form.signout_bg === 'transparent' ? '#ffffff' : safeColor(form.signout_bg, '#ffffff')} onChange={e => update('signout_bg', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="signoutText">Text &amp; border color</label>
              <input id="signoutText" type="color" value={safeColor(form.signout_text, '#49402a')} onChange={e => update('signout_text', e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
          </div>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update('signout_bg', 'transparent')}>Use transparent background</button>
        </div>

        <div className="section-actions" style={{ marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save all settings'}</button>
          <button className="btn" onClick={resetToDefault}>Reset colors to default</button>
        </div>

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
      </div>
    </AppShell>
  );
}
