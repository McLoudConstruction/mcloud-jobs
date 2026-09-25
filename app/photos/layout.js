// Share-link pages are for one recipient, not search engines, and the
// token in the URL must not leak through the Referer header.
export const metadata = {
  title: 'McLoud Construction',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }) {
  return children;
}
