const GRAPH = 'https://graph.microsoft.com/v1.0';

// Graph's $search covers subject+body, which is a bit looser than
// Gmail's subject-only query, so results still get subject-checked by
// the caller (extractJobNumberFromSubject) before being filed anywhere.
export async function listMicrosoftJobTaggedMessages(accessToken, sinceDate) {
  const filterParts = ['contains(subject,\'[Job #\')'];
  if (sinceDate) filterParts.push(`receivedDateTime ge ${new Date(sinceDate).toISOString()}`);
  const params = new URLSearchParams({
    $filter: filterParts.join(' and '),
    $top: '50',
    $orderby: 'receivedDateTime desc',
  });
  const res = await fetch(`${GRAPH}/me/mailFolders/inbox/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Outlook mail list failed: ${await res.text()}`);
  const { value } = await res.json();
  return (value || []).map(msg => ({
    providerMessageId: msg.id,
    providerThreadId: msg.conversationId,
    fromEmail: msg.from?.emailAddress?.address || '',
    toEmail: (msg.toRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
    subject: msg.subject || '',
    snippet: msg.bodyPreview || '',
    bodyText: msg.body?.contentType === 'text' ? msg.body.content : '',
    bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : '',
    receivedAt: msg.receivedDateTime,
  }));
}
