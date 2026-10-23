import { botGet } from '../../../../lib/botApi';

// GET /api/bot/sales
// Who this key is, its limits, and every value the other endpoints accept.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_me', { filters: false });
}
