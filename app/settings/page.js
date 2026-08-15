'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';

const INTEGRATIONS = [
  { key: 'quickbooks', name: 'QuickBooks', description: 'Sync invoices and payments to your books.' },
  { key: 'stripe', name: 'Payment processor (Stripe)', description: 'Accept card payments on invoices.' },
  { key: 'email', name: 'Transactional email', description: 'Auto-send proposals, contracts, and updates by email.' },
];

export default function SettingsPage() {
  const { session, loading } = useRequireAuth();
  const { settings, refresh } = useSettings();

  const [colorBg, setColorBg] = useState(settings.color_bg);
  const [colorHeading, setColorHeading] = useState(settings.color_heading);
  const [colorAccent, setColorAccent] = useState(settings.color_accent);
  const [uploading, setUploading] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setColorBg(settings.color_bg);
    setColorHeading(settings.color_heading);
    setColorAccent(settings.color_accent);
  }, [settings]);

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2000);
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setUploading(true);

    const ext = file.name.split('.').pop();
    const path = `logo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('branding').upload(path, file, { upsert: true });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path);
    const { error: updateError } = await supabase.from('app_settings').update({ logo_url: urlData.publicUrl }).eq('id', 1);

    setUploading(false);
    if (updateError) { setError(updateError.message); return; }
    showFlash('Logo updated');
    refresh();
  }

  async function saveColors() {
    setSavingColors(true);
    const { error: updateError } = await supabase
      .from('app_settings')
      .update({ color_bg: colorBg, color_heading: colorHeading, color_accent: colorAccent })
      .eq('id', 1);
    setSavingColors(false);
    if (updateError) { setError(updateError.message); return; }
    showFlash('Theme saved');
    refresh();
  }

  function resetColors() {
    setColorBg('#dbd8bf');
    setColorHeading('#49402a');
    setColorAccent('#8a3d14');
  }

  if (loading || !session) return null;

  return (
    <div>
      <div className="topbar">
        <div className="brand">McLoud <span>Jobs</span></div>
        <Link href="/dashboard" className="btn btn-sm">← Dashboard</Link>
      </div>

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
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
            This updates the logo shown in the app. Proposal, contract, and update documents still use the original letterhead logo for now — let me know if you want those switched over too.
          </div>
        </div>

        <div className="card">
          <h3>Color theme</h3>
          <div className="two-col">
            <div>
              <label htmlFor="colorBg">Background</label>
              <input id="colorBg" type="color" value={colorBg} onChange={e => setColorBg(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="colorHeading">Headings &amp; text</label>
              <input id="colorHeading" type="color" value={colorHeading} onChange={e => setColorHeading(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
            <div>
              <label htmlFor="colorAccent">Accent (buttons, badges)</label>
              <input id="colorAccent" type="color" value={colorAccent} onChange={e => setColorAccent(e.target.value)} style={{ height: 42, padding: 4 }} />
            </div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={saveColors} disabled={savingColors}>{savingColors ? 'Saving…' : 'Save theme'}</button>
            <button className="btn btn-sm" onClick={resetColors}>Reset to default</button>
          </div>
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
            These need their own accounts (QuickBooks, Stripe, an email service) set up before I can wire them in — happy to start whichever one's most useful next.
          </div>
        </div>
      </div>
    </div>
  );
}
