const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Creates or updates an all-day (date-range) event for a job's scheduled
// window. Google's end.date is exclusive, so the last day of the job
// gets rolled forward by one.
export async function upsertGoogleJobEvent(accessToken, existingEventId, { title, description, startDate, endDate }) {
  const body = {
    summary: title,
    description,
    start: { date: startDate },
    end: { date: addOneDay(endDate || startDate) },
  };
  const url = existingEventId ? `${EVENTS_URL}/${existingEventId}` : EVENTS_URL;
  const res = await fetch(url, {
    method: existingEventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Calendar event save failed: ${await res.text()}`);
  return res.json();
}

// Pulls events in a time window for the "busy" overlay — not filtered to
// job events, this is the staff member's whole primary calendar.
export async function listGoogleBusyEvents(accessToken, timeMinISO, timeMaxISO) {
  const params = new URLSearchParams({ timeMin: timeMinISO, timeMax: timeMaxISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const res = await fetch(`${EVENTS_URL}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Calendar list failed: ${await res.text()}`);
  const data = await res.json();
  return (data.items || [])
    .map(ev => ({
      externalEventId: ev.id,
      title: ev.summary || '(untitled)',
      startAt: ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null),
      endAt: ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null),
    }))
    .filter(e => e.startAt && e.endAt);
}

export async function getGoogleAccountEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}
