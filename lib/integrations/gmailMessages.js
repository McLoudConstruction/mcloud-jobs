const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

// Walks Gmail's nested MIME part tree for the first text/plain and
// text/html bodies. Gmail returns a flat body only for simple messages;
// anything with attachments or multipart alternatives nests it.
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
  if (!text && payload?.body?.data) text = decodeBase64Url(payload.body.data);
  return { text, html };
}

function header(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Gmail search query keeps this to inbox mail with our job tag in the
// subject, since when after: is set, to the connection's own sync
// checkpoint. Filtering server-side (rather than pulling everything and
// filtering in JS) keeps this cheap even on a busy mailbox.
export async function listGoogleJobTaggedMessages(accessToken, sinceDate) {
  const afterClause = sinceDate ? ` after:${Math.floor(new Date(sinceDate).getTime() / 1000)}` : '';
  const q = encodeURIComponent(`subject:"[Job #"${afterClause}`);
  const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=50`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) throw new Error(`Gmail list failed: ${await listRes.text()}`);
  const { messages } = await listRes.json();
  if (!messages?.length) return [];

  const results = [];
  for (const { id } of messages) {
    const msgRes = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!msgRes.ok) continue; // one bad message shouldn't sink the whole sync
    const msg = await msgRes.json();
    const { text, html } = extractBodies(msg.payload);
    results.push({
      providerMessageId: msg.id,
      providerThreadId: msg.threadId,
      fromEmail: header(msg.payload.headers, 'From'),
      toEmail: header(msg.payload.headers, 'To'),
      subject: header(msg.payload.headers, 'Subject'),
      snippet: msg.snippet || '',
      bodyText: text,
      bodyHtml: html,
      receivedAt: new Date(Number(msg.internalDate)).toISOString(),
    });
  }
  return results;
}
