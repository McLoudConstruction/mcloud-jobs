import { botGet, botPost } from '../../../../../lib/botApi';

// GET  /api/bot/sales/people  People (contacts) with their company and property, and whether
//                             each can be emailed. Subcontractor people are never included.
// POST /api/bot/sales/people  Add a person, or get back the one we already have.
//                             Nothing existing is overwritten.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_people_list');
}

export async function POST(request) {
  return botPost(request, 'bot_sales_person_create');
}
