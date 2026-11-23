// GET /api/staff/me (operation getCurrentStaff): the signed-in staff member, for the top bar's "Signed in as".
// 401 session_expired for no bearer token, an invalid one, a session older than 7 days, or a user who is not staff
// (src/lib/server/auth/require-staff.ts). Any other method is a 405.
import type { StaffMember } from '@/lib/api/generated/model';
import { requireStaff } from '@/lib/server/auth/require-staff';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';

export const GET = withApi('GET /api/staff/me', async (req, ctx) => {
  const staff = await requireStaff(req);
  const body: StaffMember = { user_id: staff.userId, display_name: staff.displayName };
  return json(ctx, body);
});

const notAllowed = methodNotAllowed('/api/staff/me', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
