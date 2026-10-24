import { botGetOne, botPatch } from '../../../../../../lib/botApi';

// GET   /api/bot/sales/companies/{id}  One company.
// PATCH /api/bot/sales/companies/{id}  Fill in blanks, or append a note.
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  return botGetOne(request, 'bot_sales_companies_list', params.id);
}

export async function PATCH(request, { params }) {
  return botPatch(request, 'bot_sales_company_update', params.id);
}
