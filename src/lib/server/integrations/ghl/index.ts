import 'server-only';

// src/lib/server/integrations/ghl/index.ts: the integration seam (docs/architecture.md "Integration seam").
// The A2 no-op stub is replaced by the real runner (INT1); the signature is unchanged, so the backend routes
// that call it from `after()` and the cron route (INT2) need no edit.
//
// Contract for callers:
//   - With `requestId` only that request's due jobs run (after a submission or a status change); without it,
//     every due job runs (cron). A request that did not tick the offers box has no job, so nothing runs for it.
//   - The result counts what THIS run did: claimed, and of those succeeded, waiting (retry scheduled or waiting
//     for the contact copy) and failed. A job whose lease was lost is counted as claimed only.
//   - It throws GhlStoreError (operation and SQLSTATE only) when the database fails; wrap the call in `after()`.
//     GHL failures never throw: they settle the job and show up in the counts.
import type { JobRunResult } from '@/lib/api/generated/model';
import { runGhlJobsWith } from './runner';

export type RunGhlJobsOptions = {
  /** Only this request's due jobs (after a submission or a status change); all due jobs when omitted (cron). */
  requestId?: string;
  /** Upper bound on jobs claimed in this run. */
  limit?: number;
};

export async function runGhlJobs(options: RunGhlJobsOptions = {}): Promise<JobRunResult> {
  const scope: { requestId?: string; limit?: number } = {};
  if (options.requestId !== undefined) scope.requestId = options.requestId;
  if (options.limit !== undefined) scope.limit = options.limit;
  return runGhlJobsWith(scope);
}
