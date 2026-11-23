// GET /api/quote-requests/{request_id}/photos (operation listQuoteRequestPhotos): fresh 900-second signed URLs, created with
// the staff member's own token. A thin handler over src/lib/server/services/quote-requests.ts.
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';
import { listQuoteRequestPhotos } from '@/lib/server/services/quote-requests';

type Params = { params: Promise<{ request_id: string }> };

export const GET = withApi<Params>('GET /api/quote-requests/[request_id]/photos', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  return json(ctx, await listQuoteRequestPhotos(staff.db, request_id));
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]/photos', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
