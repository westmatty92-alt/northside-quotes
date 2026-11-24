// POST /api/quote-requests/{request_id}/ghl-copy-retries (operation retryGhlCopy, US-014, Could): staff retry a failed
// GoHighLevel contact copy now. One attempt runs during the request and its copy state comes back.
//
//   1. requireStaff: anything but a valid staff session is 401 session_expired.
//   2. request_ghl_copy_retry (under the staff member's own session, RLS applies) re-arms exactly one failed contact_copy job
//      and returns its id. The database answers 409 (not_retryable) for a request whose homeowner did not tick the offers box
//      (no job exists, none is ever created: AC-014.4) and for a copy that is not failed, which includes a second click while
//      the first attempt runs (AC-014.3). Both happen BEFORE any GoHighLevel call, so a refused retry never reaches GHL.
//   3. runGhlJobsWith({ jobId }) claims that one job with a fresh lease and runs it, exactly like a cron attempt (same contact
//      match rule, so a retry never creates a second contact), and settles it with that lease.
//   4. The copy state is read back through the same mapping the request detail uses (mapGhlState), so the two never disagree.
//
// Failures go out as problem+json built from our own text (src/lib/server/http.ts). The log line carries { error_class, code }.
import { requireStaff } from '@/lib/server/auth/require-staff';
import { dbProblem, errorFields, json, methodNotAllowed, ProblemError, withApi, type DbError } from '@/lib/server/http';
import { runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { mapGhlState } from '@/lib/server/services/quote-requests';

/**
 * Seconds. One attempt is at most three 10-second GHL calls plus the database; the default of a short function would cut
 * a slow GHL off mid-attempt and leave the job leased (it would only come back after the 120-second lease).
 */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ request_id: string }> };

const internal = (errorClass: string, logCode: string) => new ProblemError(500, 'internal_error', { errorClass, logCode });

/** The contract lists 401, 404, 409 and 500 for this operation: every other database failure is a 500 with no detail. */
function retryProblem(error: DbError): ProblemError {
  if (error.code === 'PT409') return new ProblemError(409, 'not_retryable', { errorClass: 'postgrest', logCode: 'PT409' });
  const problem = dbProblem(error);
  if (problem.status === 401 || problem.status === 404) return problem;
  return internal(problem.errorClass ?? 'postgrest', problem.logCode ?? 'none');
}

export const POST = withApi<Params>('POST /api/quote-requests/[request_id]/ghl-copy-retries', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  if (!UUID.test(request_id)) throw new ProblemError(404, 'not_found');

  const armed = await staff.db.rpc('request_ghl_copy_retry', { p_request_id: request_id });
  if (armed.error) throw retryProblem(armed.error);
  const jobId = armed.data;
  if (typeof jobId !== 'string' || !UUID.test(jobId)) throw internal('BadRow', 'none');

  let claimed: number;
  try {
    // limit 1: this call settles the one job it re-armed and nothing else, whatever else is due.
    claimed = (await runGhlJobsWith({ jobId, limit: 1 })).claimed;
  } catch (error) {
    // GhlStoreError (the database failed mid-run). The job stays queued and the next cron run takes it over once its lease ends.
    const failure = errorFields(error);
    throw internal(failure.error_class, failure.code);
  }

  const copyJob = await staff.db
    .from('ghl_sync_jobs')
    .select('state, last_attempt_at')
    .eq('request_id', request_id)
    .eq('kind', 'contact_copy')
    .order('created_at', { ascending: false })
    .limit(1);
  if (copyJob.error) throw retryProblem(copyJob.error);

  // Consent is certain here: the database refused the retry of a request without it, so mapGhlState never says no-consent.
  const { copy } = mapGhlState(true, copyJob.data?.[0], undefined);
  // retried is true when this call ran an attempt. It is false only when another runner (a cron run) took the re-armed job in
  // the instant before this call could claim it: then no attempt of ours ran and the copy state is whatever it is now.
  return json(ctx, { copy, retried: claimed > 0 });
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]/ghl-copy-retries', ['POST']);
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
