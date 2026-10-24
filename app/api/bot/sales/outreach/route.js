import { botGet, botPostMany } from '../../../../../lib/botApi';

// GET  /api/bot/sales/outreach  Outreach history: bot touches and platform
//                                email sequence events, newest first. Filter by
//                                prospect_id or email so a bot can check before
//                                it contacts someone. Staff mailboxes are never
//                                included.
// POST /api/bot/sales/outreach  Log a touch made outside the platform (the
//                                bot's own email, a call, a visit, a text, a
//                                mailing). The shortest valid body is just
//                                {"email": "..."}: channel defaults to email
//                                and outcome to sent. Send up to 25 at once as
//                                {"touches": [ ... ]}. Send an Idempotency-Key
//                                header so a retry cannot log twice.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_outreach_history');
}

export async function POST(request) {
  return botPostMany(request, 'bot_sales_outreach_log', { listKey: 'touches', max: 25 });
}
