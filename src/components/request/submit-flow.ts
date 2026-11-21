// The send, as the contract describes it (docs/openapi.yaml createQuoteRequest, uploadQuotePhoto, submitQuoteRequest):
//   1. createQuoteRequest with the answers and the photo plan, which returns the upload targets
//      (or, for a token that already completed, the reference straight away),
//   2. every photo straight to Storage, in parallel (an object that already exists counts as uploaded),
//   3. submitQuoteRequest, which issues the reference.
// The calls are handed in (`FlowDeps`) so the sequence is testable on its own; the form passes the generated
// mutations and the supabase-js uploader. Every response is checked with the generated Zod schema before use.
import { ApiProblem } from '@/lib/api/fetcher';
import type { PhotoPlanContentType, PhotoUpload, QuoteRequestCreate } from '@/lib/api/generated/model';
import {
  CreateQuoteRequestResponse,
  SubmitQuoteRequestResponse,
} from '@/lib/api/generated/public-form/public-form.zod';

export interface UploadablePhoto {
  /** 1..n, the order in the photo plan. */
  position: number;
  file: File;
  contentType: PhotoPlanContentType;
  /** Already in Storage from an earlier try with the same token and the same answers: not sent again. */
  alreadyUploaded: boolean;
}

export interface FlowDeps {
  create(body: QuoteRequestCreate): Promise<{ data: unknown }>;
  submit(requestId: string): Promise<{ data: unknown }>;
  upload(target: PhotoUpload, photo: UploadablePhoto): Promise<void>;
}

export type PhotoProgress = (position: number, status: 'uploading' | 'uploaded' | 'failed') => void;

export interface FlowResult {
  requestId: string;
  reference: string;
  photoCount: number;
}

/** One or more photos did not reach Storage. */
export class UploadFailure extends Error {
  readonly positions: readonly number[];
  constructor(positions: readonly number[]) {
    super('A photo did not upload');
    this.name = 'UploadFailure';
    this.positions = positions;
  }
}

/** The server answered 2xx with a body that is not what the contract says. */
export class ContractMismatch extends Error {
  constructor(operation: string) {
    super(`The ${operation} response does not match the contract`);
    this.name = 'ContractMismatch';
  }
}

export async function runSubmission(
  body: QuoteRequestCreate,
  photos: readonly UploadablePhoto[],
  deps: FlowDeps,
  onPhoto: PhotoProgress,
): Promise<FlowResult> {
  const created = CreateQuoteRequestResponse.safeParse((await deps.create(body)).data);
  if (!created.success) throw new ContractMismatch('createQuoteRequest');
  const started = created.data;

  // The same token already completed this request: its reference comes back, nothing more to send.
  if (started.submission_state === 'submitted' && started.reference) {
    return { requestId: started.request_id, reference: started.reference, photoCount: photos.length };
  }

  const failed: number[] = [];
  await Promise.all(
    photos
      .filter((photo) => !photo.alreadyUploaded)
      .map(async (photo) => {
        const target = started.photo_uploads.find((candidate) => candidate.position === photo.position);
        if (!target) {
          failed.push(photo.position);
          onPhoto(photo.position, 'failed');
          return;
        }
        onPhoto(photo.position, 'uploading');
        try {
          await deps.upload(target, photo);
          onPhoto(photo.position, 'uploaded');
        } catch {
          failed.push(photo.position);
          onPhoto(photo.position, 'failed');
        }
      }),
  );
  if (failed.length > 0) throw new UploadFailure([...failed].sort((a, b) => a - b));

  const submitted = SubmitQuoteRequestResponse.safeParse((await deps.submit(started.request_id)).data);
  if (!submitted.success) throw new ContractMismatch('submitQuoteRequest');
  return {
    requestId: submitted.data.request_id,
    reference: submitted.data.reference,
    photoCount: submitted.data.photo_count,
  };
}

export type Failure =
  | { kind: 'validation'; errors: readonly { field: string; message: string }[] }
  | { kind: 'photos'; photos: readonly { position: number; message: string; retryable: boolean }[] }
  | { kind: 'rate-limited' }
  | { kind: 'fresh-token' }
  | { kind: 'upload'; positions: readonly number[] }
  | { kind: 'failed' };

const PHOTO_FIELD = /^photos\[(\d+)\]$/;

/**
 * Turns whatever went wrong into what the page does about it. It branches on status and `code`, never on message
 * text, and it never tells the homeowner which spam check refused her: honeypot, time trap, database down and an
 * unreadable answer are all just `failed`.
 */
export function classifyFailure(error: unknown): Failure {
  if (error instanceof UploadFailure) return { kind: 'upload', positions: error.positions };
  if (!(error instanceof ApiProblem)) return { kind: 'failed' };

  switch (error.code) {
    case 'validation_failed':
      return error.problem?.errors?.length ? { kind: 'validation', errors: error.problem.errors } : { kind: 'failed' };
    case 'photo_invalid':
    case 'photo_missing': {
      const photos = (error.problem?.errors ?? []).flatMap((item) => {
        const position = Number(PHOTO_FIELD.exec(item.field)?.[1]);
        return Number.isInteger(position) ? [{ position, message: item.message, retryable: error.code === 'photo_missing' }] : [];
      });
      return photos.length > 0 ? { kind: 'photos', photos } : { kind: 'failed' };
    }
    case 'rate_limited':
      return { kind: 'rate-limited' };
    // the page gets a fresh token, keeps everything typed, and she sends again
    case 'form_expired':
    case 'form_already_used':
    case 'form_token_invalid':
      return { kind: 'fresh-token' };
    default:
      return { kind: 'failed' };
  }
}
