import { guardAI, transcribeAudio, failure } from '../../../../lib/aiClient';

// Step 1 of voice-to-scope: turns a recorded walkthrough into plain text.
// Always uses OpenAI's Whisper endpoint (Anthropic's models don't take audio
// input) — see lib/aiClient.js's transcribeAudio(). The transcript is
// returned to the browser and handed to /api/ai/draft-scope from there;
// nothing here is saved to the database.

const MAX_BYTES = 25 * 1024 * 1024; // Whisper's own limit

export async function POST(request) {
  const gate = await guardAI(request, 'transcribe');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  try {
    const form = await request.formData();
    const file = form.get('audio');
    if (!file || typeof file === 'string') return Response.json({ error: 'No recording received.' }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: 'That recording is too long — try a shorter walkthrough.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await transcribeAudio({ buffer, filename: file.name || 'recording.webm', mimeType: file.type, config: gate.config });
    await gate.admin.from('ai_generations').insert({ staff_id: gate.staffId, feature: 'transcribe', model: 'whisper-1', ok: true });
    return Response.json({ transcript: text });
  } catch (err) {
    return failure(err, 'Could not transcribe that recording.');
  }
}
