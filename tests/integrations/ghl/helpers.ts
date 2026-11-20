// tests/integrations/ghl/helpers.ts: shared by the GHL integration tests. No network beyond the local simulator.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { GhlClient } from '@/lib/server/integrations/ghl/client';
import type { ClaimedJob, CopyJobState, GhlJobKind, RequestRow } from '@/lib/server/integrations/ghl/process-job';
import { GhlStoreError, type FinishOutcome, type JobStore, type SettledJob } from '@/lib/server/integrations/ghl/runner';
import type { GhlSimulator } from '../../mocks/ghl/simulator.mjs';

/** The env the client sees when pointed at a simulator (non-production). */
export function simEnv(sim: GhlSimulator, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    GHL_API_BASE_URL: sim.url,
    GHL_PRIVATE_INTEGRATION_TOKEN: sim.token,
    GHL_LOCATION_ID: sim.locationId,
    ...extra,
  };
}

export const HOMEOWNER = {
  name: 'Zora Quillfeather',
  phone: '4165550142',
  email: 'zora.quillfeather@example.test',
  address: '77 Marigold Crescent, Hamilton',
} as const;

export function makeRequest(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: randomUUID(),
    ...HOMEOWNER,
    status: 'new',
    marketing_consent: true,
    ghl_contact_id: null,
    ...overrides,
  };
}

export function makeJob(request: Pick<RequestRow, 'id'>, kind: GhlJobKind = 'contact_copy', overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: randomUUID(),
    request_id: request.id,
    kind,
    target_status: kind === 'stage_tag' ? 'new' : null,
    attempt_count: 0,
    lease_id: randomUUID(),
    ...overrides,
  };
}

export type FinishRecord = {
  job: ClaimedJob;
  settle: { outcome: FinishOutcome; errorClass?: string; contactId?: string };
};

/** An in-memory JobStore: scripted reads, a queue of jobs to hand out, a record of every settle. */
export class FakeStore implements JobStore {
  requests = new Map<string, RequestRow>();
  queue: ClaimedJob[] = [];
  matches = new Map<string, string | null>();
  stages = new Map<string, string | null>();
  copyStates = new Map<string, CopyJobState | null>();
  finished: FinishRecord[] = [];
  claims: Array<{ requestId?: string; jobId?: string }> = [];
  /** Replace what finish() answers (default: a normal settle, lease cleared). */
  settleOverride: ((job: ClaimedJob, outcome: FinishOutcome) => SettledJob) | undefined;
  /** Runs after every settle (the budget tests advance their clock here). */
  afterFinish: (() => void) | undefined;
  failOn: 'loadRequest' | undefined;

  add(request: RequestRow, job?: ClaimedJob): ClaimedJob {
    this.requests.set(request.id, request);
    const j = job ?? makeJob(request);
    this.queue.push(j);
    return j;
  }

  async claim(scope: { requestId?: string; jobId?: string }) {
    this.claims.push(scope);
    const index = this.queue.findIndex((j) => (scope.requestId === undefined || j.request_id === scope.requestId) && (scope.jobId === undefined || j.id === scope.jobId));
    if (index === -1) return null;
    return this.queue.splice(index, 1)[0] ?? null;
  }

  async loadRequest(requestId: string) {
    if (this.failOn === 'loadRequest') throw new GhlStoreError('load_request', '57P01');
    return this.requests.get(requestId) ?? null;
  }

  async findContactMatch(requestId: string) {
    return this.matches.get(requestId) ?? null;
  }

  async stageFor(requestId: string) {
    return this.stages.has(requestId) ? (this.stages.get(requestId) ?? null) : (this.requests.get(requestId)?.status ?? null);
  }

  async copyJobState(requestId: string) {
    return this.copyStates.get(requestId) ?? null;
  }

  async finish(job: ClaimedJob, settle: FinishRecord['settle']): Promise<SettledJob> {
    this.finished.push({ job, settle });
    this.afterFinish?.();
    if (this.settleOverride) return this.settleOverride(job, settle.outcome);
    const state = settle.outcome === 'succeeded' ? 'succeeded' : settle.outcome === 'failed' || settle.outcome === 'abandon' ? 'failed' : 'waiting';
    return { state, lease_id: null };
  }
}

/** Captures everything written to console and to the process streams while a test runs. */
export function captureOutput() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(push),
    vi.spyOn(console, 'info').mockImplementation(push),
    vi.spyOn(console, 'warn').mockImplementation(push),
    vi.spyOn(console, 'error').mockImplementation(push),
    vi.spyOn(console, 'debug').mockImplementation(push),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }),
  ];
  return {
    lines,
    text: () => lines.join('\n'),
    stop: () => spies.forEach((s) => s.mockRestore()),
  };
}

/** A client whose methods are all spies that fail the test if called: proves "no GHL call". */
export function forbiddenClient(): GhlClient {
  const boom = () => {
    throw new Error('the GHL client must not be called here');
  };
  return { findDuplicateContact: boom, createContact: boom, addTags: boom, removeTags: boom } as unknown as GhlClient;
}
