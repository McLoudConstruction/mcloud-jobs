import { botGet, botPost } from '../../../../../lib/botApi';

// GET  /api/bot/sales/outreach  Outreach history: bot touches and platform
//                                email sequence events, newest first. Filter by
//                                prospect_id or email so a bot can check before
//                                it contacts someone. Staff mailboxes are never
//                                included.
// POST /api/bot/sales/outreach  Log one touch made outside the platform (the
//                                bot's own email, a call, a text, a mailing).
//                                Send an Idempotency-Key header so a retry
//                                cannot log twice.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_outreach_history');
}

export async function POST(request) {
  return botPost(request, 'bot_sales_outreach_log');
}
