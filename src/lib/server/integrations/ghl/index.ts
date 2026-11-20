import 'server-only';

// src/lib/server/integrations/ghl/index.ts: the integration seam (docs/architecture.md "Integration seam").
// A2 SCAFFOLD STUB: a no-op that claims nothing, so the backend lane can call it from `after()` and the cron
// route before the integration lane builds the runner. The integration lane replaces the body; the signature
// stays as documented.
import type { JobRunResult } from '@/lib/api/generated/model';

export type RunGhlJobsOptions = {
  /** Only this request's due jobs (after a submission or a status change); all due jobs when omitted (cron). */
  requestId?: string;
  /** Upper bound on jobs claimed in this run. */
  limit?: number;
};

export async function runGhlJobs(options: RunGhlJobsOptions = {}): Promise<JobRunResult> {
  void options;
  return { claimed: 0, succeeded: 0, waiting: 0, failed: 0 };
}
