'use client';
import { useEffect } from 'react';
import { useSettings } from '../lib/useSettings';
import { useTheme } from '../lib/useTheme';
import { deriveThemeAccents } from '../lib/deriveAccent';

export default function BrandAccentInjector() {
  const { settings } = useSettings();
  const { theme, mounted } = useTheme();

  useEffect(() => {
    if (!mounted) return;
    const derived = deriveThemeAccents(settings.brand_color);
    if (!derived) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.style.setProperty('--accent', derived.accentDark);
      root.style.setProperty('--accent-hover', derived.accentDarkHover);
    } else {
      root.style.setProperty('--accent', derived.accentLight);
      root.style.setProperty('--accent-hover', derived.accentLightHover);
    }
    // The header is always dark chrome, in both site themes — so accent
    // colors used inside it (the notification badge, etc.) always need
    // the dark-background-safe variant, regardless of which mode the
    // rest of the page is currently in.
    root.style.setProperty('--header-accent', derived.accentDark);
  }, [settings.brand_color, theme, mounted]);

  return null;
}
