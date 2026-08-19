// Tries increasingly forgiving strategies to pull a JSON array of strings
// out of the model's response, so a stray preamble or trailing note
// doesn't waste the whole (paid-for) API call.
function extractItems(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string' && x.trim());
  } catch {}

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string' && x.trim());
    } catch {}
  }

  const quoted = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m => m[1]).filter(s => s.trim());
  if (quoted.length > 0) return quoted;

  return null;
}

export async function POST(request) {
  try {
    const { description, projectType } = await request.json();

    if (!description || !description.trim()) {
      return Response.json({ error: 'Describe the job first.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: 'AI scope generation is not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const prompt = `You are helping an experienced ${projectType === 'commercial' ? 'commercial' : 'residential'} construction contractor write the scope of work section of a CLIENT-FACING proposal — the customer will read this document. It is not an internal crew checklist or a step-by-step work breakdown.

The contractor described the job like this:
"${description.trim()}"

Write a concise, consolidated scope of work. Each line item should represent a meaningful phase or category of work, not a single micro-step — combine related tasks into one item wherever a client would naturally expect them bundled together.

For example:
- Instead of separate lines for disconnecting plumbing, disconnecting electrical, and disconnecting gas, write one line: "Disconnect and cap all plumbing, electrical, and gas lines in the work area."
- Instead of separate lines for removing upper cabinets and removing lower cabinets, write one line: "Remove and haul away existing cabinetry."
- Instead of separate lines for each reconnection step, write one line: "Reconnect and test all plumbing, electrical, and gas connections."

Aim for roughly 8-15 total line items for a job like this — enough to be clear and complete, not exhaustive. Cover the major phases: preparation/protection, demolition/removal, any rough-in adjustments, installation, and finishing/cleanup.

Respond with ONLY a JSON array of strings, one per scope item. Do not include any preamble, explanation, or markdown code fences — your entire response must be valid JSON starting with [ and ending with ].`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const fullText = data.content?.[0]?.text || '';

    const items = extractItems(fullText);
    if (!items || items.length === 0) {
      throw new Error('AI returned an unexpected format — try rephrasing the description.');
    }

    return Response.json({ items });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to generate scope.' }, { status: 500 });
  }
}
