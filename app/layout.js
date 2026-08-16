import './globals.css';
import { SettingsProvider } from '../lib/useSettings';

export const metadata = {
  title: 'McLoud Jobs',
  description: 'McLoud Construction job management',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
