import { botGetOne, botPatch } from '../../../../../../lib/botApi';

// GET   /api/bot/sales/people/{id}  One person.
// PATCH /api/bot/sales/people/{id}  Fill in blanks. Anything staff already entered is left
//                                    alone and reported under "skipped".
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  return botGetOne(request, 'bot_sales_people_list', params.id);
}

export async function PATCH(request, { params }) {
  return botPatch(request, 'bot_sales_person_update', params.id);
}
