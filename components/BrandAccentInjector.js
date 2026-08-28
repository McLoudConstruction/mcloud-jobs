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
    const root = document.documentElement;

    // Header text color is independent of the brand accent — it was
    // previously hardcoded with no way to change it. This runs before
    // the brand_color derivation below (and its early-return) because
    // this setting has nothing to do with brand_color being valid.
    // Falls back to the CSS-defined default (unset the inline override)
    // when nothing's been chosen, rather than hardcoding a fallback here.
    if (settings.header_text_color) {
      root.style.setProperty('--header-text', settings.header_text_color);
    } else {
      root.style.removeProperty('--header-text');
    }

    const derived = deriveThemeAccents(settings.brand_color);
    if (!derived) return;
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
  }, [settings.brand_color, settings.header_text_color, theme, mounted]);

  return null;
}
