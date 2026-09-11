const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIME_ZONE = 'America/Chicago';

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Creates or updates an all-day event for a job's scheduled window.
// Graph's all-day end date is exclusive, same convention as Google.
export async function upsertMicrosoftJobEvent(accessToken, existingEventId, { title, description, startDate, endDate }) {
  const body = {
    subject: title,
    body: { contentType: 'text', content: description || '' },
    isAllDay: true,
    start: { dateTime: `${startDate}T00:00:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${addOneDay(endDate || startDate)}T00:00:00`, timeZone: TIME_ZONE },
  };
  const url = existingEventId ? `${GRAPH}/me/events/${existingEventId}` : `${GRAPH}/me/events`;
  const res = await fetch(url, {
    method: existingEventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Microsoft Calendar event save failed: ${await res.text()}`);
  return res.json();
}

export async function listMicrosoftBusyEvents(accessToken, timeMinISO, timeMaxISO) {
  const params = new URLSearchParams({ startDateTime: timeMinISO, endDateTime: timeMaxISO, $top: '250' });
  const res = await fetch(`${GRAPH}/me/calendarView?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="${TIME_ZONE}"` },
  });
  if (!res.ok) throw new Error(`Microsoft Calendar list failed: ${await res.text()}`);
  const data = await res.json();
  return (data.value || [])
    .map(ev => ({
      externalEventId: ev.id,
      title: ev.subject || '(untitled)',
      startAt: ev.start?.dateTime ? `${ev.start.dateTime}Z`.replace('ZZ', 'Z') : null,
      endAt: ev.end?.dateTime ? `${ev.end.dateTime}Z`.replace('ZZ', 'Z') : null,
    }))
    .filter(e => e.startAt && e.endAt);
}

export async function getMicrosoftAccountEmail(accessToken) {
  const res = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.mail || data.userPrincipalName || null;
}
