import { guardAI, logAI, callClaude, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';

// Drafts a reply to a customer's message in a job's Messages thread, using
// what the system actually knows (stage, published schedule, recent updates).
// The draft lands in the reply box for the contractor to edit and send.

const SYSTEM = `You draft replies from McLoud Construction to a customer's message about their project.
Voice: friendly, direct, professional, first person plural. Short — usually 2–5 sentences. No emojis, no sign-off block (the app adds the sender).
Facts: answer using ONLY the job facts, schedule, and recent updates provided. If the customer asks something those facts do not answer (price changes, new dates, technical causes, warranty decisions, anything about money), do NOT guess or promise — say we'll look into it and get back to them, and put a short bracketed note for the contractor at the very end, like: [Confirm the delivery date before sending].
Never agree to pricing, discounts, extra work, or schedule commitments on the company's behalf.
${UNTRUSTED_RULE}
Reply with ONLY the message text.`;

export async function POST(request) {
  const gate = await guardAI(request, 'draft_reply');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId;
    const guidance = String(body.guidance || '').slice(0, 500);
    if (!jobId) return Response.json({ error: 'Missing job.' }, { status: 400 });

    const { admin } = gate;
    const { data: job } = await admin.from('jobs').select('customer_name, customer_contact, project_type, project_address, stage').eq('id', jobId).single();
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const [{ data: msgs }, { data: phases }, { data: updates }] = await Promise.all([
      admin.from('job_questions').select('sender, message, created_at').eq('job_id', jobId).order('created_at', { ascending: false }).limit(10),
      admin.from('job_phases').select('label, trade, start_date, end_date').eq('job_id', jobId).eq('status', 'published').order('start_date'),
      admin.from('job_updates').select('work_completed, upcoming_work, update_date').eq('job_id', jobId).eq('is_internal', false).order('update_date', { ascending: false }).limit(2),
    ]);
    const thread = (msgs || []).reverse();
    if (!thread.some(m => m.sender === 'customer')) return Response.json({ error: 'There is no customer message to reply to yet.' }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);
    const sched = (phases || []).filter(p => p.end_date >= today).slice(0, 12).map(p => `${p.start_date} to ${p.end_date}: ${p.label}${p.trade ? ` (${p.trade})` : ''}`).join('\n');
    const upd = (updates || []).map(u => `${u.update_date}: done — ${(u.work_completed || '').slice(0, 300)} | next — ${(u.upcoming_work || '').slice(0, 200)}`).join('\n');

    const content =
      `Today: ${today}\nJob: ${job.project_type || 'project'} at ${job.project_address || 'the property'}, customer ${job.customer_contact || job.customer_name || ''} (stage: ${job.stage})\n\n` +
      `Published schedule (upcoming):\n${sched || '(none published)'}\n\nLast customer-visible updates:\n${upd || '(none)'}\n\n` +
      `Conversation so far (oldest first):\n${untrusted('conversation', thread.map(m => `${m.sender === 'customer' ? 'CUSTOMER' : 'McLoud'}: ${m.message}`).join('\n'))}\n\n` +
      (guidance ? `The contractor wants the reply to: ${guidance}\n\n` : '') +
      'Write the reply to the most recent customer message.';

    const { text, usage } = await callClaude({ system: SYSTEM, content, maxTokens: 500 });
    await logAI(gate, { jobId, usage });
    return Response.json({ reply: text });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err);
  }
}
