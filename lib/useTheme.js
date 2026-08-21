'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const ThemeContext = createContext({ theme: 'light', setTheme: () => {} });

function surfaceFor(pathname) {
  if (pathname?.startsWith('/portal')) return 'portal';
  if (pathname?.startsWith('/sub-portal')) return 'subportal';
  return 'admin';
}

export function ThemeProvider({ children }) {
  const pathname = usePathname();
  const surface = surfaceFor(pathname);
  const storageKey = `mcloud-theme-${surface}`;

  const [theme, setThemeState] = useState('light');
  const [mounted, setMounted] = useState(false);

  // Re-reads whenever the surface changes (admin -> portal -> sub-portal),
  // not just on first mount — each surface's preference is independent,
  // so switching contexts should pick up that surface's own setting.
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setThemeState(initial);
    document.documentElement.setAttribute('data-theme', initial);
    setMounted(true);
  }, [storageKey]);

  function setTheme(next) {
    setThemeState(next);
    window.localStorage.setItem(storageKey, next);
    document.documentElement.setAttribute('data-theme', next);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
