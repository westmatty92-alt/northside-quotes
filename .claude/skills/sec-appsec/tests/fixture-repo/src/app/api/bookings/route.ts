// src/app/api/bookings/route.ts: TEMPLATE for a thin, contract-exact route handler.
// Operations: listBookings (GET), createBooking (POST). See docs/openapi.yaml#/paths/~1bookings
// Order in every handler: authenticate → validate (generated Zod) → one service call → shape → map errors.
import 'server-only';
import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/server/auth';
import { json, problem, fromError } from '@/lib/server/http';
import { listBookingsQueryParams, createBookingBody } from '@/lib/api/generated/bookings/bookings.zod';
import * as bookings from '@/lib/server/services/bookings';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);                         // 401 if missing
    const parsed = listBookingsQueryParams.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return problem.validation(parsed.error);      // 422 + errors[]
    const page = await bookings.listForUser(session, parsed.data);     // RLS-scoped, cursor-paginated
    return json(200, { data: page.items.map(bookings.toApi), next_cursor: page.nextCursor });
  } catch (err) {
    return fromError(err);                                             // known errors → contract codes; else 500 + request_id
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(req);
    const body = await req.json().catch(() => undefined);
    if (body === undefined) return problem.badRequest('Body must be valid JSON');      // 400
    const parsed = createBookingBody.strict().safeParse(body);
    if (!parsed.success) return problem.validation(parsed.error);                      // 422
    const booking = await bookings.create(session, parsed.data, {
      idempotencyKey: req.headers.get('Idempotency-Key') ?? undefined,                 // safe retries
    });                                                                                // throws SlotTakenError → 409
    return json(201, bookings.toApi(booking));
  } catch (err) {
    return fromError(err);
  }
}
