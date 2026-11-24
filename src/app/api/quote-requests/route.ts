// POST /api/quote-requests (operation createQuoteRequest): start a pending quote request and return the photo upload
// targets. A thin handler: the rules (token, honeypot, validation, rate limit, replay) are in
// src/lib/server/services/submissions.ts.
// GET /api/quote-requests (operation listQuoteRequests): the staff list, newest first, one RPC call, in
// src/lib/server/services/quote-requests.ts.
import { requireStaff } from '@/lib/server/auth/require-staff';
import { clientAddress } from '@/lib/server/services/network';
import { json, methodNotAllowed, readJsonBody, withApi } from '@/lib/server/http';
import { listQuoteRequests, parseListQuery } from '@/lib/server/services/quote-requests';
import { startQuoteRequest } from '@/lib/server/services/submissions';

export const GET = withApi('GET /api/quote-requests', async (req, ctx) => {
  const staff = await requireStaff(req);
  const query = parseListQuery(new URL(req.url).searchParams);
  return json(ctx, await listQuoteRequests(staff.db, query));
});

export const POST = withApi('POST /api/quote-requests', async (req, ctx) => {
  const body = await readJsonBody(req);
  const result = await startQuoteRequest({
    formToken: req.headers.get('x-form-token'),
    body,
    clientAddress: clientAddress(req.headers),
  });
  return json(ctx, result.body, result.status);
});

const notAllowed = methodNotAllowed('/api/quote-requests', ['GET', 'POST']);
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
