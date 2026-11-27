// PUT /api/quote-requests/{request_id}/quote (operation saveQuote): replace the price and note, version checked (409 when
// stale, 422 for a price outside 0.01 to 99,999.99 or a note over 1,000 characters). A thin handler over
// src/lib/server/services/quote-requests.ts.
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, readJsonBody, withApi } from '@/lib/server/http';
import { saveQuote } from '@/lib/server/services/quote-requests';

type Params = { params: Promise<{ request_id: string }> };

export const PUT = withApi<Params>('PUT /api/quote-requests/[request_id]/quote', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  const body = await readJsonBody(req);
  return json(ctx, await saveQuote(staff.db, request_id, body));
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]/quote', ['PUT']);
export const GET = notAllowed;
export const POST = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
