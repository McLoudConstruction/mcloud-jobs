import { botGet } from '../../../../../lib/botApi';

// GET /api/bot/sales/follow-up  The Sales page lists: overdue next steps, prospects with no
//                               next step, prospects gone quiet, lost ones to try again, and
//                               the scorecard. Same numbers staff see.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_follow_up');
}
