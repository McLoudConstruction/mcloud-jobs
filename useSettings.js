'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

const DEFAULTS = {
  logo_url: null,
  watermark_logo_url: null,
  brand_color: '#9b773d',
  color_bg: '#dbd8bf',
  color_heading: '#49402a',
  color_section_heading: '#9b773d',
  color_accent: '#8a3d14',
  color_panel: '#d3d0b5',
  color_header: '#d3d0b5',
  sidebar_inactive_text: '#49402a',
  sidebar_active_bg: '#49402a',
  sidebar_active_text: '#f2ede1',
  font_choice: 'system',
  logo_size_desktop: 180,
  logo_size_mobile: 150,
  signout_bg: 'transparent',
  signout_text: '#49402a',
  signout_hover_bg: '#302a1a',
  dashboard_widgets: {},
};

const FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', monospace",
  rounded: "'Trebuchet MS', 'Segoe UI', sans-serif",
};

// Any widget key not explicitly set to false is shown.
export function widgetEnabled(settings, key) {
  const widgets = settings.dashboard_widgets || {};
  return widgets[key] !== false;
}

function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--font-family', FONT_STACKS[settings.font_choice] || FONT_STACKS.system);
  root.style.setProperty('--signout-hover-bg', settings.signout_hover_bg);
}

const SettingsContext = createContext({ settings: DEFAULTS, loading: true, refresh: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    const merged = { ...DEFAULTS, ...(data || {}) };
    setSettings(merged);
    applyTheme(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Exactly one subscription for the whole app, no matter how many
    // components consume settings.
    const channel = supabase
      .channel('app-settings-singleton')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh: load }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
