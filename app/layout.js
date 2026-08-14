import './globals.css';

export const metadata = {
  title: 'McLoud Jobs',
  description: 'McLoud Construction job management',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
