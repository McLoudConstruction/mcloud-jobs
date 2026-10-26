import { guardAI, logAI, anthropicKeyFor } from '../../../lib/aiClient';

// Grammar/spelling cleanup only — not a rewrite. The priority here is
// fixing typos, punctuation, and awkward phrasing from something typed
// quickly (often on a phone, on a jobsite), while leaving the person's
// actual wording, tone, and meaning alone. The result lands back in a
// normal editable field, so the person can still tweak it before saving
// — this endpoint doesn't save anything itself.
export async function POST(request) {
  // Staff only, with an hourly limit and a usage log. 150 an hour because this one is
  // cheap and gets used in bursts (a stack of receipts, a day of notes).
  const gate = await guardAI(request, 'polish_text', { hourlyLimit: 150 });
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  try {
    const { text } = await request.json();

    if (!text || !text.trim()) {
      return Response.json({ error: 'Nothing to polish.' }, { status: 400 });
    }
    if (!anthropicKeyFor(gate)) {
      return Response.json(
        { error: 'AI polish is not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const prompt = `You are proofreading a short note written on the job by a construction contractor or project manager, often typed quickly on a phone. Your only job is to fix grammar, spelling, punctuation, and awkward phrasing.

Do NOT add information that isn't there. Do NOT change the meaning. Do NOT change the tone or make it more formal or "marketing-polished" — this is a light cleanup pass, not a rewrite. Keep it just as brief or casual as the original. Preserve line breaks and paragraph structure.

Respond with ONLY the corrected text — no preamble, no quotation marks around it, no explanation of what you changed.

Text to proofread:
"""
${text}
"""`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKeyFor(gate),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    await logAI(gate, { usage: data.usage, ok: response.ok });
    if (!response.ok) {
      throw new Error(data.error?.message || 'AI request failed.');
    }

    const polished = (data.content || []).map(block => block.text || '').join('').trim();
    if (!polished) throw new Error('AI returned an empty response.');

    return Response.json({ polished });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}
