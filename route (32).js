function extractJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }

  return null;
}

export async function POST(request) {
  try {
    const { imageBase64, mediaType } = await request.json();

    if (!imageBase64) {
      return Response.json({ error: 'No image provided.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
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
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 512,
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
