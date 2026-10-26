import { extractJson } from '../../../lib/extractJson';
import { guardAI, logAI, anthropicKeyFor } from '../../../lib/aiClient';

export async function POST(request) {
  // Staff only, with an hourly limit and a usage log. 150 an hour because this one is
  // cheap and gets used in bursts (a stack of receipts, a day of notes).
  const gate = await guardAI(request, 'extract_receipt', { hourlyLimit: 150 });
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  try {
    const { imageBase64, mediaType } = await request.json();

    if (!imageBase64) {
      return Response.json({ error: 'No image provided.' }, { status: 400 });
    }
    if (!anthropicKeyFor(gate)) {
      return Response.json(
        { error: 'AI receipt scanning is not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const prompt = `Look at this receipt image and extract these details. Respond with ONLY a JSON object, no other text, no markdown formatting:

{"vendor": "business name as shown on the receipt", "amount": total dollar amount as a plain number (no $ sign), "date": "YYYY-MM-DD", "category": one of "materials", "equipment", "permits", or "other" based on what was purchased}

If you cannot confidently read a field, use null for that field rather than guessing.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKeyFor(gate),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 768,
        // Small structured extraction, not open reasoning — same fix as
        // the other AI routes: disable adaptive thinking so the (already
        // tight) token budget goes entirely to the actual output instead
        // of being silently eaten by thinking tokens first.
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    await logAI(gate, { usage: data.usage, ok: response.ok });
    const rawText = data.content?.find(block => block.type === 'text')?.text || '';
    const extracted = extractJson(rawText);

    if (!extracted) {
      const snippet = rawText.trim() ? rawText.trim().slice(0, 300) : '(empty response — no text block found)';
      throw new Error(`AI returned an unexpected format — you can still key in the details manually. Raw response: "${snippet}"`);
    }

    return Response.json({ extracted });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to read receipt.' }, { status: 500 });
  }
}
