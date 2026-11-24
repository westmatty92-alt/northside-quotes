// GET /api/jobs/housekeeping (operation runHousekeeping): the daily purge, called by Vercel Cron with
// `Authorization: Bearer CRON_SECRET`. 401 for every call while CRON_SECRET is unset or shorter than 32 characters, and for
// `Bearer undefined`, `Bearer ` or no header (SECURITY_MODEL invariant 12; the check lives in src/lib/server/env.ts).
import { isCronRequest } from '@/lib/server/env';
import { ProblemError, errorFields, json, methodNotAllowed, withApi } from '@/lib/server/http';
import { runHousekeeping } from '@/lib/server/jobs/housekeeping';

export const GET = withApi('GET /api/jobs/housekeeping', async (req, ctx) => {
  if (!isCronRequest(req.headers.get('authorization'))) throw new ProblemError(401, 'unauthorized');
  try {
    return json(ctx, await runHousekeeping());
  } catch (error) {
    // The contract lists only 401 and 500 here, so a database that cannot be reached is a 500 as well.
    const failure = errorFields(error);
    throw new ProblemError(500, 'internal_error', { errorClass: failure.error_class, logCode: failure.code });
  }
});

const notAllowed = methodNotAllowed('/api/jobs/housekeeping', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
