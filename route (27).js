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
    const { actions } = await request.json();

    if (!Array.isArray(actions) || actions.length === 0) {
      return Response.json({ error: 'No action list to work from — build the trade breakdown on the job first.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: 'AI suggestions are not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const actionsList = actions.map(a => `- ${a.quantity ?? 1} ${a.unit_label || ''} — ${a.description} (${a.trade || 'Other'})`).join('\n');

    const prompt = `You are helping an experienced contractor draft a STARTING materials list for a job estimate, based on the exhaustive action list below. This is explicitly a draft the contractor will review and adjust — not a final answer.

Action list:
${actionsList}

For each material likely needed, suggest a description and a starting quantity based ONLY on the exact count implied by the actions — never pad the quantity yourself. For example, 2 faucet actions means quantity 2, not 3. If an action's own count is uncertain (e.g. it says "count not specified, confirm on-site"), carry that same uncertainty forward — use quantity 1 and say so in the material's description, rather than picking a specific number that wasn't actually given anywhere upstream.

Separately, for materials that are commonly bought in slight excess for practical reasons (cut waste, breakage, matching dye lots, etc. — typically lumber, sheet goods, tile, fasteners, and similar bulk/consumable materials), add a short "buffer_note" explaining why a contractor might reasonably buy a bit more, e.g. "Framing lumber — many contractors buy 1-2 extra boards for cuts and waste." Do NOT add a buffer_note for fixed-count fixtures or hardware (faucets, toilets, light fixtures, appliances, etc.) — those should just be the exact count, no note.

Do not suggest labor, permits, or anything that isn't a physical material to purchase.

Respond with a single JSON object shaped exactly like this, and nothing else:
{"materials": [{"description": "...", "quantity": 2, "unit_label": "...", "buffer_note": null}]}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    // Find the text block specifically rather than assuming it's always
    // at index 0 — a response can include other block types first,
    // which would silently produce an empty string here otherwise.
    const fullText = data.content?.find(block => block.type === 'text')?.text || '';
    const wasTruncated = data.stop_reason === 'max_tokens';
    const parsed = extractJson(fullText);
    const materials = Array.isArray(parsed?.materials) ? parsed.materials.filter(m => m && typeof m.description === 'string' && m.description.trim()) : null;

    if (!materials || materials.length === 0) {
      const snippet = fullText.trim() ? fullText.trim().slice(0, 300) : '(empty response — no text block found)';
      throw new Error(
        wasTruncated
          ? 'The AI response ran out of room before finishing — try again with a shorter action list, or just add line items manually.'
          : `AI returned an unexpected format. Raw response started with: "${snippet}"`
      );
    }

    return Response.json({
      materials: materials.map(m => ({
        description: m.description.trim(),
        quantity: Number.isFinite(m.quantity) ? m.quantity : 1,
        unit_label: typeof m.unit_label === 'string' ? m.unit_label.trim() : null,
        buffer_note: typeof m.buffer_note === 'string' && m.buffer_note.trim() ? m.buffer_note.trim() : null,
      })),
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to suggest materials.' }, { status: 500 });
  }
}
