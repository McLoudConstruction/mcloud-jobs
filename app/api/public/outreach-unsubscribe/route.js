import { createClient } from '@supabase/supabase-js';

// Unsubscribe target for outreach emails. Deliberately two-step:
//   GET  -> shows a page with an "Unsubscribe" button (so mail scanners and
//           link-preview bots that fetch every link don't unsubscribe people).
//   POST -> actually unsubscribes. This is also what mail clients call for
//           the one-click List-Unsubscribe-Post header (RFC 8058).
// Uses the anon key: outreach_unsubscribe() is granted to anon and can only
// act on the enrollment that owns the token.

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title, message, formToken) {
  const form = formToken
    ? `<form method="POST" action="/api/public/outreach-unsubscribe?t=${formToken}"><button type="submit">Unsubscribe</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f1e8;color:#1c1b19;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.box{background:#fff;border:1px solid #ddd6c6;border-radius:8px;padding:32px;max-width:420px;margin:16px;text-align:center}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 18px;line-height:1.5;color:#4a4436}
button{background:#7d5a2e;color:#fff;border:0;border-radius:6px;padding:10px 22px;font-size:15px;cursor:pointer}</style></head>
<body><div class="box"><h1>${title}</h1><p>${message}</p>${form}</div></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function tokenFrom(request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  return TOKEN_PATTERN.test(t) ? t : null;
}

export async function GET(request) {
  const token = tokenFrom(request);
  if (!token) return page('Link not recognized', 'This unsubscribe link is invalid or incomplete.');
  return page('Unsubscribe from McLoud Construction emails?', 'Click below and you won&rsquo;t receive any more outreach emails from us.', token);
}

export async function POST(request) {
  const token = tokenFrom(request);
  if (!token) return page('Link not recognized', 'This unsubscribe link is invalid or incomplete.');
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data, error } = await supabase.rpc('outreach_unsubscribe', { p_token: token });
    if (error) throw new Error(error.message);
    if (!data) return page('Link not recognized', 'This unsubscribe link is invalid or has expired.');
    return page('You&rsquo;re unsubscribed', 'You won&rsquo;t receive any more outreach emails from McLoud Construction.');
  } catch (err) {
    console.error('outreach unsubscribe failed:', err.message);
    return page('Something went wrong', 'We couldn&rsquo;t process that just now. Please try again in a few minutes, or reply to any of our emails and we&rsquo;ll remove you by hand.');
  }
}
