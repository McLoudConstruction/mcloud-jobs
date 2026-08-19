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

    const prompt = `You are helping an experienced ${projectType === 'commercial' ? 'commercial' : 'residential'} construction contractor build a detailed, itemized scope of work for a client proposal.

The contractor described the job like this:
"${description.trim()}"

List every specific task a professional scope of work should include for this job — the obvious main task, plus everything it typically requires along with it (removal/haul-away, disconnecting and reconnecting fixtures, prep work, hookups, finish work, etc.). Be practical and specific, the way an experienced contractor would write it in a real proposal — not vague or generic.

Respond with ONLY a JSON array of strings, one per scope item. No other text before or after it, no markdown formatting, no code fences.`;

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
        temperature: 0,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '[' }, // forces the response to continue straight into JSON, no preamble possible
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const continuation = data.content?.[0]?.text || '';
    const fullText = '[' + continuation; // re-attach the prefilled opening bracket

    const items = extractItems(fullText);
    if (!items || items.length === 0) {
      throw new Error('AI returned an unexpected format — try rephrasing the description.');
    }

    return Response.json({ items });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to generate scope.' }, { status: 500 });
  }
}
