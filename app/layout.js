import './globals.css';
import { SettingsProvider } from '../lib/useSettings';
import { ThemeProvider } from '../lib/useTheme';
import BrandAccentInjector from '../components/BrandAccentInjector';

export const metadata = {
  title: 'McLoud Jobs',
  description: 'McLoud Construction job management',
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
