'use client';
import { useRouter } from 'next/navigation';

// The "Back" control on document viewer pages (estimate, contract, invoice,
// change order, work order, update, material selection). These pages are
// always reached from some specific spot in the app — the job's Documents
// tab, a specific Financials section, a notification link, etc. — but the
// old plain <Link> pointed at a single hardcoded href per page (usually
// just `/jobs/{id}`, which lands on the job's Overview tab regardless of
// where the person actually came from).
//
// Using the browser's own history instead means "Back" always returns to
// whatever page/tab was last visited, not a guess baked in at build time.
// `fallbackHref` is still used when there's no in-app history to go back
// to — e.g. the document was opened directly from a bookmark, a new tab,
// or an emailed link.
export default function DocBackLink({ fallbackHref, className, children = '← Back' }) {
  const router = useRouter();

  function handleClick(e) {
    e.preventDefault();
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <a href={fallbackHref} className={className} onClick={handleClick}>{children}</a>
  );
}
