import { createHash, timingSafeEqual } from 'node:crypto';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';
import {
  loadAvailability,
  pickOffer,
  isDateString,
  isTimeString,
  slotLabel,
} from '../../../../../lib/consultSlots';
import { VERTICAL_KEYS, verticalLabel } from '../../../../../lib/verticals';

// Server to server routes for the website chat assistant on
// mcloudconstruction.com. NOT for browsers: every call must carry the shared
// secret in the x-chat-secret header (CHAT_SHARED_SECRET, set the same in both
// Vercel projects), and the marketing site's /api/chat is the only caller.
//
//   POST /api/public/chat/guard         rate limit a visitor, open or reuse a transcript
//   POST /api/public/chat/log           append messages to the transcript
//   POST /api/public/chat/availability  open consultation times
//   POST /api/public/chat/book          book a consultation and create the lead
//   POST /api/public/chat/lead          create a lead for the team to follow up (no booking)
//
// Visitors are identified only by a salted hash of their IP address, computed
// by the marketing site. The raw address never reaches this database.

const MESSAGES_PER_HOUR = 40;
const CONVERSATIONS_PER_DAY = 10;
const BOOKINGS_PER_DAY = 2;
const LEADS_PER_DAY = 3;
const GLOBAL_MESSAGES_PER_DAY = Number(process.env.CHAT_DAILY_MESSAGE_CAP) || 3000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function authorized(request) {
  const secret = process.env.CHAT_SHARED_SECRET;
  if (!secret || secret.length < 16) return 'not_configured';
  const given = Buffer.from(request.headers.get('x-chat-secret') || '');
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'denied';
  return 'ok';
}

function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Keeps line breaks (for notes) but limits length.
function cleanMultiline(value, max) {
  return String(value ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function formatPhone(value) {
  const d = String(value || '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

async function countEvents(admin, ipHash, kind, sinceMs) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { count } = await admin
    .from('chat_rate_events')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('kind', kind)
    .gte('created_at', since);
  return count || 0;
}

async function addEvent(admin, ipHash, kind) {
  await admin.from('chat_rate_events').insert({ ip_hash: ipHash, kind });
}

function slotsForReply(offer) {
  return offer.map(d => ({
    date: d.date,
    slots: d.slots.map(s => ({ date: s.date, time: s.time, label: s.label })),
  }));
}

// ── guard ───────────────────────────────────────────────────────────────
async function guard(admin, body) {
  const ipHash = String(body.ipHash || '');
  if (!HASH_PATTERN.test(ipHash)) return [400, { ok: false, reason: 'bad_request' }];

  if ((await countEvents(admin, ipHash, 'message', HOUR_MS)) >= MESSAGES_PER_HOUR) {
    return [429, { ok: false, reason: 'rate_limited' }];
  }
  const { count: globalCount } = await admin
    .from('chat_rate_events')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'message')
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
  if ((globalCount || 0) >= GLOBAL_MESSAGES_PER_DAY) return [429, { ok: false, reason: 'busy' }];

  let conversationId = null;
  if (UUID_PATTERN.test(String(body.conversationId || ''))) {
    const { data: existing } = await admin
      .from('chat_conversations')
      .select('id, ip_hash')
      .eq('id', body.conversationId)
      .maybeSingle();
    if (existing && existing.ip_hash === ipHash) conversationId = existing.id;
  }
  if (!conversationId) {
    if ((await countEvents(admin, ipHash, 'conversation', DAY_MS)) >= CONVERSATIONS_PER_DAY) {
      return [429, { ok: false, reason: 'rate_limited' }];
    }
    const { data: created, error } = await admin
      .from('chat_conversations')
      .insert({
        ip_hash: ipHash,
        visitor_id: clean(body.visitorId, 64) || null,
        page_path: clean(body.pagePath, 200) || null,
      })
      .select('id')
      .single();
    if (error) return [500, { ok: false, reason: 'error' }];
    conversationId = created.id;
    await addEvent(admin, ipHash, 'conversation');
  }

  await addEvent(admin, ipHash, 'message');

  // Housekeeping: now and then, drop rate rows older than three days.
  if (Math.random() < 0.02) {
    await admin.from('chat_rate_events').delete().lt('created_at', new Date(Date.now() - 3 * DAY_MS).toISOString());
  }
  return [200, { ok: true, conversationId }];
}

// ── log ─────────────────────────────────────────────────────────────────
async function log(admin, body) {
  if (!UUID_PATTERN.test(String(body.conversationId || ''))) return [400, { ok: false }];
  const { data: convo } = await admin
    .from('chat_conversations')
    .select('id, messages, user_message_count, escalated')
    .eq('id', body.conversationId)
    .maybeSingle();
  if (!convo) return [404, { ok: false }];

  const incoming = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(0, 6)
    .map(m => ({ role: m.role, content: cleanMultiline(m.content, 4000), at: new Date().toISOString() }))
    .filter(m => m.content);

  const messages = [...(convo.messages || []), ...incoming].slice(-200);
  const update = {
    messages,
    user_message_count: (convo.user_message_count || 0) + incoming.filter(m => m.role === 'user').length,
    last_message_at: new Date().toISOString(),
  };
  if (body.escalated) {
    update.escalated = true;
    update.escalation_reason = clean(body.escalationReason, 300) || null;
  }
  if (UUID_PATTERN.test(String(body.opportunityId || ''))) update.opportunity_id = body.opportunityId;

  const { error } = await admin.from('chat_conversations').update(update).eq('id', convo.id);
  return error ? [500, { ok: false }] : [200, { ok: true }];
}

// ── availability ────────────────────────────────────────────────────────
async function availability(admin, body) {
  const fromDate = isDateString(body.fromDate) ? body.fromDate : undefined;
  const { settings, tz, slots } = await loadAvailability(admin, { fromDate });
  if (!settings || !settings.enabled) return [200, { ok: true, enabled: false, days: [] }];
  const offer = pickOffer(slots, { days: 5, perDay: 4 });
  return [
    200,
    { ok: true, enabled: true, timezone: tz, durationMinutes: settings.slot_minutes, days: slotsForReply(offer) },
  ];
}

// ── book ────────────────────────────────────────────────────────────────
async function book(admin, body) {
  const ipHash = String(body.ipHash || '');
  if (!HASH_PATTERN.test(ipHash)) return [400, { ok: false, reason: 'bad_request' }];

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = formatPhone(body.phone);
  const address = clean(body.address, 250);
  const description = cleanMultiline(body.description, 1500);
  const project = clean(body.project, 200);
  const company = clean(body.company, 150);
  const projectType = body.projectType === 'commercial' ? 'commercial' : 'residential';
  const date = String(body.date || '');
  const time = String(body.time || '');

  const problems = [];
  if (!name) problems.push('name');
  if (!EMAIL_PATTERN.test(email)) problems.push('a valid email');
  if (!phone) problems.push('a 10 digit phone number');
  if (!address) problems.push('the property address');
  if (!description) problems.push('a short description of the project');
  if (projectType === 'commercial' && !company) problems.push('the company name');
  if (!isDateString(date) || !isTimeString(time)) problems.push('a valid date and time');
  if (problems.length) return [400, { ok: false, reason: 'missing_info', missing: problems }];

  if ((await countEvents(admin, ipHash, 'booking', DAY_MS)) >= BOOKINGS_PER_DAY) {
    return [429, { ok: false, reason: 'booking_limit' }];
  }

  const { settings, tz, slots } = await loadAvailability(admin, { fromDate: date });
  if (!settings || !settings.enabled) return [200, { ok: false, reason: 'booking_off' }];
  const slot = slots.find(s => s.date === date && s.time === time);
  if (!slot) {
    const nearby = pickOffer(slots, { days: 3, perDay: 3 });
    return [200, { ok: false, reason: 'slot_unavailable', days: slotsForReply(nearby) }];
  }

  // One upcoming consultation per person. The set of upcoming consultations is
  // small, so compare emails here rather than in a pattern match (an address
  // can contain characters that act as wildcards in one).
  const { data: upcoming } = await admin
    .from('opportunities')
    .select('contact_email, bid_walk_scheduled_at')
    .gt('bid_walk_scheduled_at', new Date().toISOString())
    .limit(500);
  const existing = (upcoming || []).find(o => String(o.contact_email || '').trim().toLowerCase() === email);
  if (existing) {
    return [200, {
      ok: false,
      reason: 'already_booked',
      label: slotLabel(new Date(existing.bid_walk_scheduled_at), tz),
    }];
  }

  const vertical = VERTICAL_KEYS.includes(body.vertical) ? body.vertical : projectType === 'residential' ? 'residential' : null;
  const notes = [
    'Booked through the website chat assistant.',
    `Consultation: ${slot.label}`,
    project ? `Project: ${project}` : null,
    '',
    description,
  ].filter(line => line !== null).join('\n').trim();

  const { data: lead, error: leadError } = await admin
    .from('opportunities')
    .insert({
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      project_type: projectType,
      company: company || null,
      project: project || null,
      address,
      notes,
      stage: 'prospecting',
      source: 'website_chat',
      lead_vertical: vertical,
      landing_path: clean(body.pagePath, 200) || null,
      bid_walk_scheduled_at: slot.start,
    })
    .select('id')
    .single();
  if (leadError) return [500, { ok: false, reason: 'error' }];

  const { error: bookError } = await admin.from('consult_bookings').insert({
    opportunity_id: lead.id,
    starts_at: slot.start,
    ends_at: slot.end,
    source: 'chat',
    conversation_id: UUID_PATTERN.test(String(body.conversationId || '')) ? body.conversationId : null,
  });
  if (bookError) {
    await admin.from('opportunities').delete().eq('id', lead.id);
    if (bookError.code === '23505') {
      // Someone else took this exact time a moment ago.
      const refreshed = await loadAvailability(admin, { fromDate: date });
      return [200, { ok: false, reason: 'slot_unavailable', days: slotsForReply(pickOffer(refreshed.slots, { days: 3, perDay: 3 })) }];
    }
    return [500, { ok: false, reason: 'error' }];
  }

  await addEvent(admin, ipHash, 'booking');
  if (UUID_PATTERN.test(String(body.conversationId || ''))) {
    await admin.from('chat_conversations').update({ opportunity_id: lead.id }).eq('id', body.conversationId);
  }
  await admin.from('notifications').insert({
    job_id: null,
    message: `Consultation booked by the website chat: ${name}${company ? ` (${company})` : ''}, ${slot.label}. ${projectType} project${project ? `: ${project}` : ''}. ${address}. Call ${phone} or email ${email} to confirm.`,
  });

  return [200, { ok: true, label: slot.label, leadId: lead.id }];
}

// ── lead (the visitor needs a person) ───────────────────────────────────
async function lead(admin, body) {
  const ipHash = String(body.ipHash || '');
  if (!HASH_PATTERN.test(ipHash)) return [400, { ok: false, reason: 'bad_request' }];

  const name = clean(body.name, 120);
  const emailRaw = clean(body.email, 200).toLowerCase();
  const email = emailRaw && EMAIL_PATTERN.test(emailRaw) ? emailRaw : '';
  const phone = formatPhone(body.phone);
  const reason = clean(body.reason, 300);
  const summary = cleanMultiline(body.summary, 1500);

  const problems = [];
  if (!name) problems.push('name');
  if (!email && !phone) problems.push('a phone number or email');
  if (emailRaw && !email) problems.push('a valid email');
  if (clean(body.phone, 40) && !phone) problems.push('a 10 digit phone number');
  if (!reason && !summary) problems.push('what they need');
  if (problems.length) return [400, { ok: false, reason: 'missing_info', missing: problems }];

  if ((await countEvents(admin, ipHash, 'lead', DAY_MS)) >= LEADS_PER_DAY) {
    return [429, { ok: false, reason: 'lead_limit' }];
  }

  const projectType = body.projectType === 'commercial' ? 'commercial' : 'residential';
  const notes = [
    'Website chat: the visitor asked for a person to follow up.',
    reason ? `Why: ${reason}` : null,
    '',
    summary,
  ].filter(line => line !== null).join('\n').trim();

  const { data: created, error } = await admin
    .from('opportunities')
    .insert({
      contact_name: name,
      contact_email: email || null,
      contact_phone: phone || null,
      project_type: projectType,
      company: clean(body.company, 150) || null,
      project: clean(body.project, 200) || null,
      address: clean(body.address, 250) || null,
      notes,
      stage: 'prospecting',
      source: 'website_chat',
      lead_vertical: projectType === 'residential' ? 'residential' : null,
      landing_path: clean(body.pagePath, 200) || null,
    })
    .select('id')
    .single();
  if (error) return [500, { ok: false, reason: 'error' }];

  await addEvent(admin, ipHash, 'lead');
  if (UUID_PATTERN.test(String(body.conversationId || ''))) {
    await admin
      .from('chat_conversations')
      .update({ opportunity_id: created.id, escalated: true, escalation_reason: reason || null })
      .eq('id', body.conversationId);
  }
  await admin.from('notifications').insert({
    job_id: null,
    message: `Website chat needs a person: ${name}${reason ? `, ${reason}` : ''}. ${phone ? `Call ${phone}` : ''}${phone && email ? ' or ' : ''}${email ? `email ${email}` : ''}.`.replace(/\s+/g, ' '),
  });

  return [200, { ok: true, leadId: created.id }];
}

const HANDLERS = { guard, log, availability, book, lead };

export async function POST(request, { params }) {
  const handler = HANDLERS[params.action];
  if (!handler) return Response.json({ error: 'Not found.' }, { status: 404 });

  const auth = authorized(request);
  if (auth === 'not_configured') return Response.json({ error: 'Not configured.' }, { status: 503 });
  if (auth !== 'ok') return Response.json({ error: 'Not allowed.' }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'Not configured.' }, { status: 503 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Bad request.' }, { status: 400 });

  try {
    const [status, payload] = await handler(getAdminClient(), body);
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
