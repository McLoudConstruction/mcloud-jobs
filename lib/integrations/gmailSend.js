const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047 encoded-word for any header value that isn't plain ASCII
// (subjects and display names with accents, emoji, curly quotes...).
function encodeHeaderValue(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function encodeDisplayName(name) {
  if (!name) return '';
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}"`;
  return encodeHeaderValue(name);
}

function wrap76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

// Builds a multipart/alternative RFC 5322 message (plain text + HTML).
export function buildRawMessage({ fromName, fromEmail, to, subject, text, html, extraHeaders = {} }) {
  const boundary = `mcloud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const from = fromName ? `${encodeDisplayName(fromName)} <${fromEmail}>` : fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text || '', 'utf-8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html || '', 'utf-8').toString('base64')),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

// Sends through the connected staff member's own Gmail account (needs the
// gmail.send scope). Returns Gmail's message id and thread id.
export async function sendGmail(accessToken, message) {
  const raw = base64Url(buildRawMessage(message));
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
  const data = await res.json();
  return { messageId: data.id, threadId: data.threadId };
}

// Looks at one Gmail thread and reports whether anyone other than the
// mailbox owner has written in it. Bounce notices come from mailer-daemon /
// postmaster and are reported separately from human replies. Auto-replies
// (out-of-office) count as replies — deliberately conservative, since the
// alternative is emailing someone who already answered. Needs only the
// gmail.readonly scope the app already requests.
export async function getThreadReplyStatus(accessToken, threadId, mailboxEmail) {
  const url = `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return 'none'; // thread deleted — nothing to go on
  if (!res.ok) throw new Error(`Gmail thread lookup failed: ${await res.text()}`);
  const thread = await res.json();
  const me = (mailboxEmail || '').toLowerCase();
  let replied = false;
  for (const msg of thread.messages || []) {
    const from = ((msg.payload?.headers || []).find(h => h.name.toLowerCase() === 'from')?.value || '').toLowerCase();
    if (!from || (me && from.includes(me))) continue;
    if (/mailer-daemon|postmaster/.test(from)) return 'bounced';
    replied = true;
  }
  return replied ? 'replied' : 'none';
}
