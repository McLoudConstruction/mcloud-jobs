import { botPost } from '../../../../../lib/botApi';

// POST /api/bot/sales/outreach
// Log one touch made outside the platform (the bot's own email, a call, a
// text, a mailing). Send an Idempotency-Key header so a retry cannot log twice.
export const dynamic = 'force-dynamic';

export async function POST(request) {
  return botPost(request, 'bot_sales_outreach_log');
}
