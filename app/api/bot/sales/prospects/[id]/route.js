import { botGetOne, botPatch } from '../../../../../../lib/botApi';

// GET   /api/bot/sales/prospects/{id}  One prospect (a property).
// PATCH /api/bot/sales/prospects/{id}  Move it along: stage, next step, lost reason and try
//                                       again date. Descriptive fields only fill blanks.
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  return botGetOne(request, 'bot_sales_prospects_list', params.id);
}

export async function PATCH(request, { params }) {
  return botPatch(request, 'bot_sales_prospect_update', params.id);
}
