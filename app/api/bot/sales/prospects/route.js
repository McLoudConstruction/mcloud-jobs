import { botGet, botPost } from '../../../../../lib/botApi';

// GET  /api/bot/sales/prospects   read prospects (and the people on them)
// POST /api/bot/sales/prospects   add a prospect, or get the existing one back
// Filters and fields are checked by the database. See BOT_API.md.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_prospects_list');
}

export async function POST(request) {
  return botPost(request, 'bot_sales_prospect_create');
}
