// GET /api/jobs/ghl-sync (operation runGhlSyncJobs): runs every due GoHighLevel contact copy and stage-tag attempt.
// Called by the four daily Vercel Cron entries with `Authorization: Bearer CRON_SECRET`, and by QA by hand on staging, where
// Vercel runs no cron (docs/integration-contract.md "Sync jobs"). 401 for every call while CRON_SECRET is unset or shorter than
// 32 characters, and for `Bearer undefined`, `Bearer ` or no header (SECURITY_MODEL invariant 12; the check lives in
// src/lib/server/env.ts and the check runs before anything else, so a refused call reads and calls nothing).
//
// The work is the integration seam's runGhlJobs() with NO request id: every due job, one claim at a time, each with its own
// lease, until nothing is due or less than 60 s of the 300 s function budget is left (the runner keeps that budget). The
// runner is idempotent: a second or concurrent call claims only what is still due and unleased, so nothing runs twice.
// GHL failures never reach this route (they settle the job and show up in the counts); only a database failure does, and it
// is a 500 with no detail.
import { isCronRequest } from '@/lib/server/env';
import { ProblemError, errorFields, json, methodNotAllowed, withApi } from '@/lib/server/http';
import { runGhlJobs } from '@/lib/server/integrations/ghl';

/** Vercel's function cap in seconds: the runner's 300 s budget (RUN_BUDGET_MS) needs the whole of it. */
export const maxDuration = 300;

export const GET = withApi('GET /api/jobs/ghl-sync', async (req, ctx) => {
  if (!isCronRequest(req.headers.get('authorization'))) throw new ProblemError(401, 'unauthorized');
  try {
    const result = await runGhlJobs();
    // Exactly the contract's JobRunResult, whatever else the seam may add later.
    return json(ctx, { claimed: result.claimed, succeeded: result.succeeded, waiting: result.waiting, failed: result.failed });
  } catch (error) {
    // The contract lists only 401 and 500 here. Log the kind of failure and its SQLSTATE, never a message.
    const failure = errorFields(error);
    throw new ProblemError(500, 'internal_error', { errorClass: failure.error_class, logCode: failure.code });
  }
});

const notAllowed = methodNotAllowed('/api/jobs/ghl-sync', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
