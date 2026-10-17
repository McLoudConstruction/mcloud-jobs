import { checkTranscriptionAvailable } from '../../../../lib/aiClient';
import { requireStaff } from '../../../../lib/integrations/authHelper';

export const dynamic = 'force-dynamic';

// Tells the Scope card whether to offer "Record a walkthrough". Staff only.
// Returns { available: boolean, reason? }. Never returns a key.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (auth.error) return Response.json({ available: false, reason: 'not_signed_in' }, { status: auth.status });
  try {
    return Response.json(await checkTranscriptionAvailable());
  } catch {
    return Response.json({ available: false, reason: 'check_failed' });
  }
}
