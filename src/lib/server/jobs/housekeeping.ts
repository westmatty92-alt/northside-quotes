import 'server-only';

// src/lib/server/jobs/housekeeping.ts: the daily purge (docs/architecture.md "Housekeeping", runHousekeeping in the contract).
//   - pending requests older than 24 hours and their uploaded files (a homeowner who never finished);
//   - every counter row older than 24 hours: rate_limit_hits and spam_refusal_windows (counted together as
//     rate_limit_rows_purged), sign_in_attempts and sign_in_pauses (together as sign_in_rows_purged).
// Spam events themselves are kept (they hold no address). One of the modules allowed to use the service-role client
// (SECURITY_MODEL invariant 2). Nothing here reads or logs a column of a request: ids and counts only.
import type { HousekeepingResult } from '@/lib/api/generated/model';
import { getAdminClient } from '@/lib/server/admin';
import { dbProblem } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import { removeRequestUploads } from '@/lib/server/services/submissions';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;
const MAX_BATCHES = 10; // 1,000 abandoned requests a run is far beyond the expected volume (about 7 a day)

/** Purge stale pending requests (files first, then rows) in batches. A request whose files could not be removed stays for the next run. */
async function purgePending(cutoff: string): Promise<{ requests: number; photos: number }> {
  const db = getAdminClient();
  let requests = 0;
  let photos = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const stale = await db.from('quote_requests').select('id').eq('state', 'pending').lt('created_at', cutoff).order('created_at').limit(BATCH);
    if (stale.error) throw dbProblem(stale.error);
    if (stale.data.length === 0) break;

    const clearable: string[] = [];
    for (const { id } of stale.data) {
      try {
        photos += await removeRequestUploads(id);
        clearable.push(id);
      } catch {
        logLine('warn', { quote_request_id: id, outcome: 'pending_files_not_removed', error_class: 'storage', code: 'remove' });
      }
    }
    if (clearable.length === 0) break;

    // state = pending again in the delete, so a request that was stored in the meantime is never removed
    const deleted = await db.from('quote_requests').delete({ count: 'exact' }).in('id', clearable).eq('state', 'pending');
    if (deleted.error) throw dbProblem(deleted.error);
    requests += deleted.count ?? 0;
    if (stale.data.length < BATCH) break;
  }
  return { requests, photos };
}

async function purgeOlderThan(
  table: 'rate_limit_hits' | 'spam_refusal_windows' | 'sign_in_attempts' | 'sign_in_pauses',
  cutoff: string,
): Promise<number> {
  const { error, count } = await getAdminClient().from(table).delete({ count: 'exact' }).lt('created_at', cutoff);
  if (error) throw dbProblem(error);
  return count ?? 0;
}

/** Run the purge. Throws a ProblemError (500 or 503 through withApi) when the database fails; counts only in the result. */
export async function runHousekeeping(nowMs: number = Date.now()): Promise<HousekeepingResult> {
  const cutoff = new Date(nowMs - DAY_MS).toISOString();
  const pending = await purgePending(cutoff);
  const rateRows = (await purgeOlderThan('rate_limit_hits', cutoff)) + (await purgeOlderThan('spam_refusal_windows', cutoff));
  const signInRows = (await purgeOlderThan('sign_in_attempts', cutoff)) + (await purgeOlderThan('sign_in_pauses', cutoff));
  return {
    pending_requests_purged: pending.requests,
    photos_purged: pending.photos,
    rate_limit_rows_purged: rateRows,
    sign_in_rows_purged: signInRows,
  };
}
