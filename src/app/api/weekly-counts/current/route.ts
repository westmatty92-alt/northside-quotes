// GET /api/weekly-counts/current (operation getCurrentWeeklyCount): this week's requests, won and lost, Monday 00:00 to the
// next Monday 00:00 America/Toronto, won and lost by the date of the change to that status. A thin handler over
// src/lib/server/services/quote-requests.ts (the arithmetic is in the weekly_counts() database function).
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';
import { getCurrentWeeklyCount } from '@/lib/server/services/quote-requests';

export const GET = withApi('GET /api/weekly-counts/current', async (req, ctx) => {
  const staff = await requireStaff(req);
  return json(ctx, await getCurrentWeeklyCount(staff.db));
});

const notAllowed = methodNotAllowed('/api/weekly-counts/current', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
