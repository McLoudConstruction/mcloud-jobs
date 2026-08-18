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

Respond with ONLY a JSON array of strings, one per scope item, no other text, no markdown formatting. Example shape:
["Remove and haul away existing kitchen cabinets", "Disconnect and cap plumbing at sink location", "Install new cabinetry per selected layout"]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '[]';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let items;
    try {
      items = JSON.parse(cleaned);
    } catch {
      throw new Error('AI returned an unexpected format — try rephrasing the description.');
    }

    if (!Array.isArray(items)) throw new Error('AI returned an unexpected format.');

    return Response.json({ items });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to generate scope.' }, { status: 500 });
  }
}
