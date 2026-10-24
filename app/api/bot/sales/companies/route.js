import { botGet, botPost } from '../../../../../lib/botApi';

// GET  /api/bot/sales/companies  Companies with their people, properties and touches.
//                                Subcontractors are never included.
// POST /api/bot/sales/companies  Add a company, or get back the one we already have.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return botGet(request, 'bot_sales_companies_list');
}

export async function POST(request) {
  return botPost(request, 'bot_sales_company_create');
}
