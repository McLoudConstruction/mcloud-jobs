// Outlook / Microsoft 365 side of the CRM email log. Same two step shape as
// gmailScan.js: read lightweight headers for a time window across every
// folder except Drafts, Deleted Items and Junk, then fetch the full body
// only for messages that matched a CRM record. Uses the Mail.Read scope the
// connection already has.

const GRAPH = 'https://graph.microsoft.com/v1.0';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function graphGet(url, accessToken, extraHeaders = {}) {
  let lastText = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders } });
    if (res.ok) return res.json();
    lastText = await res.text();
    if (res.status !== 429 && res.status < 500) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep((retryAfter > 0 ? retryAfter : attempt + 1) * 1000);
  }
  throw new Error(`Outlook request failed: ${lastText.slice(0, 300)}`);
}

async function wellKnownFolderId(accessToken, name) {
  try {
    const folder = await graphGet(`${GRAPH}/me/mailFolders/${name}?$select=id`, accessToken);
    return folder.id || null;
  } catch {
    return null; // some mailboxes lack one of these folders
  }
}

const recipients = list => (list || []).map(r => r.emailAddress?.address).filter(Boolean).join(', ');

export const outlookScanner = {
  async listWindow(accessToken, { after, before, deadline }) {
    const [sentId, ...skipIds] = await Promise.all([
      wellKnownFolderId(accessToken, 'sentitems'),
      wellKnownFolderId(accessToken, 'drafts'),
      wellKnownFolderId(accessToken, 'deleteditems'),
      wellKnownFolderId(accessToken, 'junkemail'),
    ]);
    const skip = new Set(skipIds.filter(Boolean));

    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${new Date(after).toISOString()} and receivedDateTime lt ${new Date(before).toISOString()}`,
      $select: 'id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,parentFolderId,isDraft',
      $top: '100',
    });

    const messages = [];
    let url = `${GRAPH}/me/messages?${params}`;
    while (url) {
      if (Date.now() > deadline) return { messages: [], incomplete: true };
      const page = await graphGet(url, accessToken);
      for (const msg of page.value || []) {
        if (msg.isDraft || skip.has(msg.parentFolderId)) continue;
        messages.push({
          id: msg.id,
          threadId: msg.conversationId,
          from: msg.from?.emailAddress?.address || '',
          to: recipients(msg.toRecipients),
          cc: [recipients(msg.ccRecipients), recipients(msg.bccRecipients)].filter(Boolean).join(', '),
          subject: msg.subject || '',
          snippet: msg.bodyPreview || '',
          receivedAt: msg.receivedDateTime,
          outbound: Boolean(sentId) && msg.parentFolderId === sentId,
        });
      }
      url = page['@odata.nextLink'] || '';
    }
    return { messages, incomplete: false };
  },

  async fetchBody(accessToken, id) {
    const msg = await graphGet(
      `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=body,bodyPreview`,
      accessToken,
      { Prefer: 'outlook.body-content-type="text"' }
    );
    return { bodyText: msg.body?.content || '', snippet: msg.bodyPreview || '' };
  },
};
