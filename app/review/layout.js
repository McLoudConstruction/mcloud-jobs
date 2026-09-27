// Review links are for one customer, not search engines, and the token in the
// URL must not leak through the Referer header.
export const metadata = {
  title: 'Review your project — McLoud Construction',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ReviewLayout({ children }) {
  return children;
}
