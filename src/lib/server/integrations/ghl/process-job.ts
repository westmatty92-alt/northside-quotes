import 'server-only';
import { GhlError, type GhlClient, type GhlErrorClass } from './client';
import { isContactId, isStage, otherStageTags, tagsToAdd, type CopySource, type Stage } from './mapping';

// src/lib/server/integrations/ghl/process-job.ts: what one claimed job does, as a verdict. No database
// access of its own (the store interface below is the seam) and no logging. docs/integration-contract.md
// "Contact match rule", "Events and webhooks", "When the platform is down".

export type GhlJobKind = 'contact_copy' | 'stage_tag';

/** A claimed job: the row `claim_ghl_job` returned, with the lease this runner must settle it with. */
export type ClaimedJob = {
  id: string;
  request_id: string;
  kind: GhlJobKind;
  target_status: string | null;
  attempt_count: number;
  /** The lease of THIS claim (S0 SEC-7). Never reused for another job. */
  lease_id: string;
};

/** The request fields the runner reads: what the copy sends, the consent, the link. */
export type RequestRow = CopySource & {
  id: string;
  status: string;
  marketing_consent: boolean;
  ghl_contact_id: string | null;
};

export type CopyJobState = 'pending' | 'waiting' | 'succeeded' | 'failed' | 'superseded';

/** The reads the processor needs. The database implementation is in runner.ts (the one service-role importer). */
export type JobReads = {
  loadRequest(requestId: string): Promise<RequestRow | null>;
  /** `public.find_ghl_contact_match(request_id)`: step 1 of the match rule. */
  findContactMatch(requestId: string): Promise<string | null>;
  /** `public.ghl_stage_for_request(request_id)`: the stage tag the contact must carry (last change wins). */
  stageFor(requestId: string): Promise<string | null>;
  /** State of the request's contact_copy job. */
  copyJobState(requestId: string): Promise<CopyJobState | null>;
};

export type Verdict =
  | { kind: 'succeeded'; contactId?: string }
  /** The attempt did not work. The class decides whether the database retries or fails the job at once. */
  | { kind: 'failed'; errorClass: GhlErrorClass; code?: string | number }
  /** A stage tag whose contact copy has not succeeded yet: no attempt is counted. */
  | { kind: 'wait' }
  /** Nothing to do and nothing to retry: the job ends as failed without an attempt counted. */
  | { kind: 'abandon'; reason: 'no_consent' | 'copy_failed' | 'no_contact' };

const serverError = (code: string): Verdict => ({ kind: 'failed', errorClass: 'server_error', code });

export async function processJob(job: ClaimedJob, reads: JobReads, client: GhlClient): Promise<Verdict> {
  const request = await reads.loadRequest(job.request_id);
  // Defence in depth (ruling 1B): a trigger already stops a job for an unticked request. If one ever
  // existed anyway, it makes no call at all.
  if (request === null || !request.marketing_consent) return { kind: 'abandon', reason: 'no_consent' };

  return job.kind === 'contact_copy' ? contactCopy(job, request, reads, client) : stageTag(job, request, reads, client);
}

async function currentStage(requestId: string, fallback: string | null, reads: JobReads): Promise<Stage | null> {
  const stage = (await reads.stageFor(requestId)) ?? fallback;
  return isStage(stage) ? stage : null;
}

/** Link to a contact that already exists: tags only, never a contact field (OQ-19A, AC-009.5, AC-017.14). */
async function link(contactId: string, request: RequestRow, reads: JobReads, client: GhlClient): Promise<Verdict> {
  if (!isContactId(contactId)) return serverError('contact_id');
  const stage = await currentStage(request.id, request.status, reads);
  if (stage === null) return serverError('stage');
  await client.addTags(contactId, tagsToAdd(stage));
  await client.removeTags(contactId, otherStageTags(stage));
  return { kind: 'succeeded', contactId };
}

async function contactCopy(job: ClaimedJob, request: RequestRow, reads: JobReads, client: GhlClient): Promise<Verdict> {
  // 1. Our own database: another consented request of the same homeowner that is already linked.
  const matched = await reads.findContactMatch(job.request_id);
  if (matched !== null) return link(matched, request, reads, client);

  // 2. GHL's duplicate search (a contact whose create reply was lost, AC-009.4).
  const found = await client.findDuplicateContact({ email: request.email, phone: request.phone });
  if (found !== null) return link(found.id, request, reads, client);

  // 3. Create, carrying `quote-request` and the stage tag of the request's status now.
  const stage = await currentStage(request.id, request.status, reads);
  if (stage === null) return serverError('stage');
  try {
    const created = await client.createContact({
      name: request.name,
      phone: request.phone,
      email: request.email,
      address: request.address,
      tags: tagsToAdd(stage),
    });
    return { kind: 'succeeded', contactId: created.id };
  } catch (error) {
    // A 400 on create is most likely a refused duplicate ("Allow Duplicate Contact" off). Repeat the search
    // once in the same attempt: found -> link (one contact); not found -> the error stands (`rejected`, fails at once).
    if (error instanceof GhlError && error.status === 400) {
      const again = await client.findDuplicateContact({ email: request.email, phone: request.phone });
      if (again !== null) return link(again.id, request, reads, client);
    }
    throw error;
  }
}

async function stageTag(job: ClaimedJob, request: RequestRow, reads: JobReads, client: GhlClient): Promise<Verdict> {
  const contactId = request.ghl_contact_id;
  if (contactId === null) {
    // The contact copy has not linked a contact yet: wait for it without counting an attempt, or give up
    // with it when it failed (the contract: "if the copy fails, the stage tag fails too").
    const copy = await reads.copyJobState(job.request_id);
    if (copy === 'pending' || copy === 'waiting') return { kind: 'wait' };
    return { kind: 'abandon', reason: copy === 'failed' ? 'copy_failed' : 'no_contact' };
  }
  if (!isContactId(contactId)) return serverError('contact_id');

  // Every attempt re-reads the stage, so a late retry never puts back an older one (AC-017.15).
  const stage = await currentStage(request.id, job.target_status, reads);
  if (stage === null) return serverError('stage');
  await client.addTags(contactId, tagsToAdd(stage));
  await client.removeTags(contactId, otherStageTags(stage));
  return { kind: 'succeeded' };
}
