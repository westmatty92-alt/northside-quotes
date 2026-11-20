import 'server-only';
import type { JobRunResult } from '@/lib/api/generated/model';
import { getAdminClient } from '@/lib/server/admin';
import { createGhlClient, GhlError, NON_RETRYABLE_CLASSES, type GhlClient, type GhlErrorClass } from './client';
import { logGhl, type GhlLogger } from './log';
import {
  processJob,
  type ClaimedJob,
  type CopyJobState,
  type GhlJobKind,
  type JobReads,
  type RequestRow,
  type Verdict,
} from './process-job';

// src/lib/server/integrations/ghl/runner.ts: the GHL job runner. This is the ONE integration file that imports
// the service-role client (SECURITY_MODEL invariant 2: "claim and settle jobs, read the request's contact fields").
//
// The loop (docs/integration-contract.md "Sync jobs"):
//   claim ONE due job with a fresh lease -> process it -> settle it with THAT lease -> repeat,
//   until nothing is due, `limit` jobs were claimed, or less than 60 s of the 300 s function budget is left.
// Only a request that ticked the offers box has a job, so only such a request ever causes a call (ruling 1B).

/** Vercel's function cap, and what the runner keeps in reserve (S0 build requirement: stop with under 60 s left). */
export const RUN_BUDGET_MS = 300_000;
export const RUN_RESERVE_MS = 60_000;

export type FinishOutcome = 'succeeded' | 'retry' | 'failed' | 'wait' | 'abandon';

/** What `finish_ghl_job` handed back: enough to tell whether our result was applied. */
export type SettledJob = { state: string; lease_id: string | null };

export type JobStore = JobReads & {
  /** `claim_ghl_job`: lease one due job (of one request, or exactly one job) or null. */
  claim(scope: { requestId?: string; jobId?: string }): Promise<ClaimedJob | null>;
  /** `finish_ghl_job`: settle with the lease this runner was given. */
  finish(job: ClaimedJob, settle: { outcome: FinishOutcome; errorClass?: GhlErrorClass; contactId?: string }): Promise<SettledJob>;
};

/** A database failure, reduced to the operation and the SQLSTATE: never the message, details or hint (invariant 11). */
export class GhlStoreError extends Error {
  readonly operation: string;
  readonly code: string;
  constructor(operation: string, code: string | undefined) {
    super(`GHL job store failed: ${operation}`);
    this.name = 'GhlStoreError';
    this.operation = operation;
    this.code = code ?? 'unknown';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY_STATES: readonly string[] = ['pending', 'waiting', 'succeeded', 'failed', 'superseded'];

/** The database store: RPCs and reads through the service-role client. */
export function createAdminStore(): JobStore {
  return {
    async claim(scope) {
      const { data, error } = await getAdminClient().rpc('claim_ghl_job', {
        p_request_id: scope.requestId,
        p_job_id: scope.jobId,
      });
      if (error) throw new GhlStoreError('claim', error.code);
      const row = data?.[0];
      if (!row) return null;
      if ((row.kind !== 'contact_copy' && row.kind !== 'stage_tag') || typeof row.lease_id !== 'string') {
        throw new GhlStoreError('claim', 'unusable_row');
      }
      return {
        id: row.id,
        request_id: row.request_id,
        kind: row.kind as GhlJobKind,
        target_status: row.target_status,
        attempt_count: row.attempt_count,
        lease_id: row.lease_id,
      };
    },

    async loadRequest(requestId) {
      const { data, error } = await getAdminClient()
        .from('quote_requests')
        .select('id, name, phone, email, address, status, marketing_consent, ghl_contact_id')
        .eq('id', requestId)
        .maybeSingle();
      if (error) throw new GhlStoreError('load_request', error.code);
      return (data as RequestRow | null) ?? null;
    },

    async findContactMatch(requestId) {
      const { data, error } = await getAdminClient().rpc('find_ghl_contact_match', { p_request_id: requestId });
      if (error) throw new GhlStoreError('find_match', error.code);
      return (data as string | null) ?? null;
    },

    async stageFor(requestId) {
      const { data, error } = await getAdminClient().rpc('ghl_stage_for_request', { p_request_id: requestId });
      if (error) throw new GhlStoreError('stage_for', error.code);
      return (data as string | null) ?? null;
    },

    async copyJobState(requestId) {
      const { data, error } = await getAdminClient()
        .from('ghl_sync_jobs')
        .select('state')
        .eq('request_id', requestId)
        .eq('kind', 'contact_copy')
        .maybeSingle();
      if (error) throw new GhlStoreError('copy_state', error.code);
      return data && COPY_STATES.includes(data.state) ? (data.state as CopyJobState) : null;
    },

    async finish(job, settle) {
      const { data, error } = await getAdminClient().rpc('finish_ghl_job', {
        p_job_id: job.id,
        p_lease_id: job.lease_id,
        p_outcome: settle.outcome,
        p_error_class: settle.errorClass,
        p_contact_id: settle.contactId,
      });
      if (error) throw new GhlStoreError('finish', error.code);
      return { state: data.state, lease_id: data.lease_id };
    },
  };
}

export type RunDeps = {
  store?: JobStore;
  client?: GhlClient;
  now?: () => number;
  budgetMs?: number;
  reserveMs?: number;
  log?: GhlLogger;
};

export type RunOptions = {
  /** Only this request's due jobs (after a submission or a status change); all due jobs when omitted (cron). */
  requestId?: string;
  /** Exactly this job (manual retry, INT2). */
  jobId?: string;
  /** Upper bound on jobs claimed in this run. */
  limit?: number;
};

function settleFor(verdict: Verdict): { outcome: FinishOutcome; errorClass?: GhlErrorClass; contactId?: string } {
  switch (verdict.kind) {
    case 'succeeded':
      return verdict.contactId === undefined ? { outcome: 'succeeded' } : { outcome: 'succeeded', contactId: verdict.contactId };
    case 'failed':
      // finish_ghl_job fails auth, config_missing and rejected at once whatever we pass; we say it too.
      return { outcome: NON_RETRYABLE_CLASSES.includes(verdict.errorClass) ? 'failed' : 'retry', errorClass: verdict.errorClass };
    case 'wait':
      return { outcome: 'wait' };
    case 'abandon':
      return { outcome: 'abandon' };
  }
}

export async function runGhlJobsWith(options: RunOptions = {}, deps: RunDeps = {}): Promise<JobRunResult> {
  const result: JobRunResult = { claimed: 0, succeeded: 0, waiting: 0, failed: 0 };
  const log = deps.log ?? logGhl;
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? RUN_BUDGET_MS;
  const reserveMs = deps.reserveMs ?? RUN_RESERVE_MS;

  if ((options.requestId !== undefined && !UUID.test(options.requestId)) || (options.jobId !== undefined && !UUID.test(options.jobId))) {
    log({ level: 'warn', outcome: 'bad_scope' });
    return result;
  }
  const max = options.limit === undefined ? Infinity : Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : 0;

  const store = deps.store ?? createAdminStore();
  const client = deps.client ?? createGhlClient();
  const startedAt = now();

  while (result.claimed < max) {
    if (budgetMs - (now() - startedAt) < reserveMs) {
      log({ level: 'warn', outcome: 'budget_reached' });
      break;
    }

    const scope: { requestId?: string; jobId?: string } = {};
    if (options.requestId !== undefined) scope.requestId = options.requestId;
    if (options.jobId !== undefined) scope.jobId = options.jobId;
    const job = await store.claim(scope);
    if (job === null) break;
    result.claimed += 1;

    let verdict: Verdict;
    try {
      verdict = await processJob(job, store, client);
    } catch (error) {
      if (error instanceof GhlStoreError) throw error; // the database is the problem: stop, the lease expires by itself
      if (error instanceof GhlError) {
        verdict = { kind: 'failed', errorClass: error.errorClass, ...(error.status === undefined ? {} : { code: error.status }) };
      } else {
        // A bug must not leave a leased job behind or loop: it counts as one failed attempt (bounded retries).
        verdict = { kind: 'failed', errorClass: 'server_error', code: 'unexpected' };
      }
    }

    const settled = await store.finish(job, settleFor(verdict));
    const base = { job_id: job.id, attempt: job.attempt_count + 1, quote_request_id: job.request_id };

    // The database ignores a result whose lease is not the job's current one (re-claimed after expiry, or the job
    // was superseded). Then the row comes back still leased, or superseded, and nothing was recorded (SEC-7).
    if (settled.lease_id !== null || settled.state === 'superseded') {
      log({ ...base, level: 'warn', outcome: 'lease_lost' });
      continue;
    }

    if (settled.state === 'succeeded') result.succeeded += 1;
    else if (settled.state === 'failed') result.failed += 1;
    else result.waiting += 1;

    log({
      ...base,
      level: verdict.kind === 'failed' ? 'warn' : 'info',
      outcome: verdict.kind === 'failed' ? settled.state : verdict.kind,
      ...(verdict.kind === 'failed' ? { error_class: verdict.errorClass } : {}),
      ...(verdict.kind === 'failed' && verdict.code !== undefined ? { code: verdict.code } : {}),
    });
  }

  return result;
}
