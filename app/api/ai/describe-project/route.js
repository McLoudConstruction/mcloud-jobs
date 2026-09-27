import { guardAI, logAI, callClaude, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';

// Turns a job's scope-of-work bullets into the short "project description"
// paragraph at the top of a proposal. Draft only — it fills the field and the
// contractor edits it before saving.

const SYSTEM = `You write the short project description that opens a contractor's proposal to a customer.
2–4 sentences of plain, confident prose in the third person about the work ("McLoud Construction will…"). Summarize the scope in the customer's terms — what they will end up with — not a line-by-line list.
Use ONLY the scope items and project details provided. Do not mention price, timeline, warranties, materials brands, or anything not in the scope. No headings, no bullets, no emojis.
${UNTRUSTED_RULE}
Reply with ONLY the paragraph.`;

export async function POST(request) {
  const gate = await guardAI(request, 'describe_project');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId;
    if (!jobId) return Response.json({ error: 'Missing job.' }, { status: 400 });
    const { admin } = gate;
    const { data: job } = await admin.from('jobs').select('project_type, project_address, scope_items').eq('id', jobId).single();
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });
    const items = (job.scope_items || []).map(s => (s.text || '').trim()).filter(Boolean);
    const { data: actions } = await admin.from('job_scope_actions').select('*').eq('job_id', jobId).limit(60);
    const actionLines = (actions || []).map(a => [a.trade, `${a.quantity && a.quantity !== 1 ? a.quantity + ' ' : ''}${a.unit_label ? a.unit_label + ' ' : ''}${a.description}`.trim()].filter(Boolean).join(' — ')).filter(Boolean);
    if (!items.length && !actionLines.length) return Response.json({ error: 'Add some scope items first — there is nothing to describe yet.' }, { status: 400 });

    const content = `Project type: ${job.project_type || 'not specified'}\nLocation: ${job.project_address || 'not specified'}\n\nScope of work:\n${untrusted('scope', (items.length ? items : actionLines).slice(0, 60).map(t => `- ${t.slice(0, 300)}`).join('\n'))}`;
    const { text, usage } = await callClaude({ system: SYSTEM, content, maxTokens: 400 });
    await logAI(gate, { jobId, usage });
    return Response.json({ description: text });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err);
  }
}
