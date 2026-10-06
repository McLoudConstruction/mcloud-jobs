// Gmail side of the CRM email log. Two cheap steps so the whole mailbox never
// has to be downloaded:
//   1. listWindow  lists message ids for a time window, then reads only the
//      headers (From, To, Cc, Bcc, Subject) of each one.
//   2. fetchBody   is called later, and only for messages that matched a
//      CRM record.
// Uses the gmail.readonly scope the connection already has.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HEADER_FETCH_CONCURRENCY = 8;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retries rate limits and transient server errors with a short backoff.
async function gmailGet(url, accessToken) {
  let lastText = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return res.json();
    lastText = await res.text();
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit/i.test(lastText));
    if (!retryable) break;
    await sleep(800 * (attempt + 1));
  }
  throw new Error(`Gmail request failed: ${lastText.slice(0, 300)}`);
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function header(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBodies(payload) {
  let text = '';
  let html = '';
  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) text ||= decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/html' && part.body?.data) html ||= decodeBase64Url(part.body.data);
    (part.parts || []).forEach(walk);
  }
  walk(payload);
  if (!text && !html && payload?.body?.data) text = decodeBase64Url(payload.body.data);
  return { text, html };
}

function htmlToText(html) {
  return (html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const epoch = d => Math.floor(new Date(d).getTime() / 1000);

export const gmailScanner = {
  // Returns { messages, incomplete }. `incomplete` is true when the time
  // budget ran out before the window was fully read, so the caller must not
  // advance its checkpoint.
  async listWindow(accessToken, { after, before, deadline }) {
    // Drafts and chats are never real correspondence. Spam and trash are
    // excluded by the API unless asked for.
    const q = encodeURIComponent(`after:${epoch(after)} before:${epoch(before)} -in:drafts -in:chats`);

    const ids = [];
    let pageToken = '';
    do {
      const page = await gmailGet(`${GMAIL}/messages?q=${q}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ''}`, accessToken);
      (page.messages || []).forEach(m => ids.push(m.id));
      pageToken = page.nextPageToken || '';
      if (pageToken && Date.now() > deadline) return { messages: [], incomplete: true };
    } while (pageToken);

    const params = ['From', 'To', 'Cc', 'Bcc', 'Subject'].map(h => `metadataHeaders=${h}`).join('&');
    let timedOut = false;
    const rows = await mapPool(ids, HEADER_FETCH_CONCURRENCY, async id => {
      if (timedOut || Date.now() > deadline) { timedOut = true; return null; }
      try {
        const msg = await gmailGet(`${GMAIL}/messages/${id}?format=metadata&${params}`, accessToken);
        const h = msg.payload?.headers || [];
        return {
          id: msg.id,
          threadId: msg.threadId,
          from: header(h, 'From'),
          to: header(h, 'To'),
          cc: [header(h, 'Cc'), header(h, 'Bcc')].filter(Boolean).join(', '),
          subject: header(h, 'Subject'),
          snippet: msg.snippet || '',
          receivedAt: new Date(Number(msg.internalDate)).toISOString(),
          outbound: (msg.labelIds || []).includes('SENT'),
        };
      } catch (err) {
        // A message deleted between the list and the read is not an error.
        if (/404|notFound/i.test(err.message)) return undefined;
        throw err;
      }
    });

    if (timedOut) return { messages: [], incomplete: true };
    return { messages: rows.filter(Boolean), incomplete: false };
  },

  async fetchBody(accessToken, id) {
    const msg = await gmailGet(`${GMAIL}/messages/${id}?format=full`, accessToken);
    const { text, html } = extractBodies(msg.payload);
    return { bodyText: text || htmlToText(html), snippet: msg.snippet || '' };
  },
};
