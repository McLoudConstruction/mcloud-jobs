import Link from 'next/link';

export default function Breadcrumb({ href, label }) {
  return (
    <Link href={href} className="breadcrumb-link">
      ← {label}
    </Link>
  );
}
