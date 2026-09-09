// Takes the raw label/value pairs the bookmarklet scraped off a retailer
// product page (loosely filtered — short-ish label, not a full sentence)
// and asks Claude to keep only the ones that actually describe the
// physical product: material, finish, dimensions, hole count, capacity,
// whatever's relevant for that specific item. Everything about the
// retailer itself (store, delivery, financing, account, navigation)
// gets dropped.
//
// This replaces an earlier hand-maintained keyword allowlist, which
// worked for the terms it knew about but had no way to recognize a
// field it hadn't been told about yet (e.g. "Number of Faucet Holes"
// for a faucet vs. "Door Handing" for a door) — every new product
// category meant another round of manually extending the list. An AI
// classifier generalizes across categories without that maintenance.

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
    const { pairs } = await request.json();

    if (!pairs || typeof pairs !== 'object' || Object.keys(pairs).length === 0) {
      return Response.json({ specs: [] });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      // No key configured — fail safe by returning nothing extra rather
      // than an unfiltered list; the dedicated color/dimension fields
      // still work regardless, this only affects the "other details"
      // checklist.
      return Response.json({ specs: [] });
    }

    const entries = Object.entries(pairs).slice(0, 40);
    const listText = entries.map(([label, value]) => `- "${label}": "${value}"`).join('\n');

    const prompt = `Below are label/value pairs scraped from a home improvement retailer's product page (Home Depot, Lowe's, etc.). Some describe the physical product itself (material, finish, dimensions, capacity, hole count, voltage, whatever's relevant for that specific item's category). Others are unrelated retailer page content (store info, delivery/pickup, financing offers, account/login, navigation, breadcrumbs, review or Q&A counts, promotional banners).

Return ONLY the pairs that describe an attribute of the physical product itself. Drop everything else. Clean up the label to a short, human-readable title (e.g. "door handing" -> "Door Handing") but keep the value as-is.

Pairs:
${listText}

Respond with a single JSON object shaped exactly like this, and nothing else:
{"specs": [{"label": "...", "value": "..."}]}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      return Response.json({ specs: [] });
    }

    const data = await response.json();
    const fullText = data.content?.find(block => block.type === 'text')?.text || '';
    const parsed = extractJson(fullText);
    const specs = Array.isArray(parsed?.specs)
      ? parsed.specs.filter(s => s && typeof s.label === 'string' && typeof s.value === 'string' && s.label.trim() && s.value.trim())
      : [];

    return Response.json({
      specs: specs.map(s => ({ label: s.label.trim(), value: s.value.trim() })),
    });
  } catch (err) {
    // Same fail-safe as above — an empty extra-specs list rather than
    // surfacing an error for what's already an optional, supplementary
    // part of the capture.
    return Response.json({ specs: [] });
  }
}
