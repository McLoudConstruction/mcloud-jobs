'use client';
import { useEffect, useState } from 'react';

export default function InstallBookmarkletPage() {
  const [href, setHref] = useState('');

  useEffect(() => {
    fetch('/api/bookmarklet-code')
      .then(r => r.text())
      .then(code => setHref('javascript:' + encodeURIComponent(code)));
  }, []);

  return (
    <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>Add to Selections</h1>
      <p>Drag this button to your bookmarks bar. On any Home Depot or Lowe's product page, click it to pull the item into a job's material selection sheet.</p>
      {href && (
        <a
          href={href}
          onClick={e => e.preventDefault()}
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            background: '#1c1b19',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontSize: 14,
            cursor: 'grab',
            margin: '16px 0',
          }}
        >
          + Add to Selections
        </a>
      )}
      <p style={{ fontSize: 13, color: '#666' }}>
        If your browser bar isn't showing, enable it first (Chrome: ⌘⇧B / Ctrl+Shift+B), then drag the button above onto it.
      </p>
      <p style={{ fontSize: 13, color: '#666' }}>
        Works on Home Depot and Lowe's product pages today. Other retailers can be added on request.
      </p>
    </div>
  );
}
