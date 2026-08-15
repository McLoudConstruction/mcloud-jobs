'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

const DEFAULTS = {
  logo_url: null,
  color_bg: '#dbd8bf',
  color_heading: '#49402a',
  color_accent: '#8a3d14',
};

function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--bg', settings.color_bg);
  root.style.setProperty('--heading', settings.color_heading);
  root.style.setProperty('--rust', settings.color_accent);
  root.style.setProperty('--rust-dim', settings.color_accent);
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
