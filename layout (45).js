import './globals.css';
import { SettingsProvider } from '../lib/useSettings';
import { ThemeProvider } from '../lib/useTheme';
import BrandAccentInjector from '../components/BrandAccentInjector';

export const metadata = {
  title: 'McLoud Jobs',
  description: 'McLoud Construction job management',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <SettingsProvider>
            <BrandAccentInjector />
            {children}
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
