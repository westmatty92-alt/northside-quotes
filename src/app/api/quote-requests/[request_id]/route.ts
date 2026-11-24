// GET /api/quote-requests/{request_id} (operation getQuoteRequest): one submitted request in full, with signed photo URLs and
// the GoHighLevel state. A thin handler over src/lib/server/services/quote-requests.ts; an unknown or pending id is 404.
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';
import { getQuoteRequest } from '@/lib/server/services/quote-requests';

type Params = { params: Promise<{ request_id: string }> };

export const GET = withApi<Params>('GET /api/quote-requests/[request_id]', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  return json(ctx, await getQuoteRequest(staff.db, request_id));
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
