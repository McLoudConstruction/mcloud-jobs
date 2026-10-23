import { botGet } from '../../../../../lib/botApi';

// GET /api/bot/sales/leads
// Read only. Filters: stage, source, vertical, project_type, q, created_since,
// updated_since, limit, cursor. See BOT_API.md.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_leads_list');
}
