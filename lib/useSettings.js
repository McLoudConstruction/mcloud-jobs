'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

const DEFAULTS = {
  logo_url: null,
  color_bg: '#dbd8bf',
  color_heading: '#49402a',
  color_accent: '#8a3d14',
  color_panel: '#d3d0b5',
  font_choice: 'system',
  logo_size_desktop: 180,
  logo_size_mobile: 120,
  signout_bg: 'transparent',
  signout_text: '#49402a',
};

const FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', monospace",
  rounded: "'Trebuchet MS', 'Segoe UI', sans-serif",
};

function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--bg', settings.color_bg);
  root.style.setProperty('--heading', settings.color_heading);
  root.style.setProperty('--rust', settings.color_accent);
  root.style.setProperty('--rust-dim', settings.color_accent);
  root.style.setProperty('--panel', settings.color_panel);
  root.style.setProperty('--font-family', FONT_STACKS[settings.font_choice] || FONT_STACKS.system);
}

export function useSettings() {
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
    const channel = supabase
      .channel('app-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  return { settings, loading, refresh: load };
}
