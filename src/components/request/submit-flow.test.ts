// The send's sequence and how each failure is classified (no DOM needed).
import { describe, expect, it, vi } from 'vitest';
import { ApiNetworkError, ApiProblem } from '@/lib/api/fetcher';
import type { Problem, ProblemCode, QuoteRequestCreate } from '@/lib/api/generated/model';
import {
  classifyFailure,
  ContractMismatch,
  runSubmission,
  UploadFailure,
  type FlowDeps,
  type UploadablePhoto,
} from '@/components/request/submit-flow';

const ID = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
const body: QuoteRequestCreate = {
  name: 'Dana Whitfield',
  phone: '905-555-0142',
  email: 'dana@example.com',
  address: '14 Barton St W, Hamilton ON',
  problem: 'Kitchen tap drips constantly',
  urgency: 'soon',
  marketing_consent: false,
  website: '',
  photos: [],
};

const startedBody = (photoPositions: number[] = [], state: 'pending' | 'submitted' = 'pending') => ({
  request_id: ID,
  submission_state: state,
  reference: state === 'submitted' ? 'NQ-7K3M9P' : null,
  photo_uploads: photoPositions.map((position) => ({
    position,
    bucket: 'quote-photos',
    path: `${ID}/photo-${position}`,
    content_type: 'image/jpeg',
  })),
  upload_expires_at: state === 'pending' ? '2026-11-19T15:10:00Z' : null,
});
const submittedBody = { request_id: ID, reference: 'NQ-7K3M9P', submitted_at: '2026-11-19T14:10:00Z', photo_count: 1 };

const photo = (position: number, alreadyUploaded = false): UploadablePhoto => ({
  position,
  file: new File(['x'], `p${position}.jpg`, { type: 'image/jpeg' }),
  contentType: 'image/jpeg',
  alreadyUploaded,
});

function deps(overrides: Partial<FlowDeps> = {}): FlowDeps {
  return {
    create: vi.fn().mockResolvedValue({ data: startedBody([1, 2]) }),
    submit: vi.fn().mockResolvedValue({ data: submittedBody }),
    upload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function problem(status: number, code: ProblemCode, errors?: Problem['errors']) {
  const value: Problem = { type: 'about:blank', title: 'x', status, code, ...(errors ? { errors } : {}) };
  return new ApiProblem(status, value, new Headers());
}

describe('runSubmission', () => {
  it('creates, uploads every photo to the path it was given, then submits, in that order', async () => {
    const order: string[] = [];
    const d = deps({
      create: vi.fn(async () => (order.push('create'), { data: startedBody([1, 2]) })),
      upload: vi.fn(async () => void order.push('upload')),
      submit: vi.fn(async () => (order.push('submit'), { data: submittedBody })),
    });
    const progress = vi.fn();
    const result = await runSubmission(body, [photo(1), photo(2)], d, progress);

    expect(result).toEqual({ requestId: ID, reference: 'NQ-7K3M9P', photoCount: 1 });
    expect(order).toEqual(['create', 'upload', 'upload', 'submit']);
    expect(d.upload).toHaveBeenCalledWith(expect.objectContaining({ path: `${ID}/photo-1` }), expect.objectContaining({ position: 1 }));
    expect(progress).toHaveBeenCalledWith(2, 'uploading');
    expect(progress).toHaveBeenCalledWith(2, 'uploaded');
    expect(d.submit).toHaveBeenCalledWith(ID);
  });

  it('with no photos it submits straight away', async () => {
    const d = deps({ create: vi.fn().mockResolvedValue({ data: startedBody() }) });
    await runSubmission(body, [], d, vi.fn());
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.submit).toHaveBeenCalledTimes(1);
  });

  it('skips photos that are already uploaded', async () => {
    const d = deps();
    await runSubmission(body, [photo(1, true), photo(2)], d, vi.fn());
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it('a token that already completed returns its reference and does nothing more', async () => {
    const d = deps({ create: vi.fn().mockResolvedValue({ data: startedBody([], 'submitted') }) });
    const result = await runSubmission(body, [photo(1)], d, vi.fn());
    expect(result.reference).toBe('NQ-7K3M9P');
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it('a failed upload stops before submit and names the positions that failed', async () => {
    const progress = vi.fn();
    const d = deps({
      upload: vi.fn(async (_target, p: UploadablePhoto) => {
        if (p.position === 2) throw new Error('offline');
      }),
    });
    await expect(runSubmission(body, [photo(1), photo(2)], d, progress)).rejects.toEqual(new UploadFailure([2]));
    expect(progress).toHaveBeenCalledWith(2, 'failed');
    expect(d.submit).not.toHaveBeenCalled();
  });

  it('a planned photo with no upload target counts as failed', async () => {
    const d = deps({ create: vi.fn().mockResolvedValue({ data: startedBody([1]) }) });
    await expect(runSubmission(body, [photo(1), photo(2)], d, vi.fn())).rejects.toBeInstanceOf(UploadFailure);
  });

  it('refuses a response that is not what the contract says', async () => {
    const bad = deps({ create: vi.fn().mockResolvedValue({ data: { request_id: 'nope' } }) });
    await expect(runSubmission(body, [], bad, vi.fn())).rejects.toBeInstanceOf(ContractMismatch);
    const badSubmit = deps({ submit: vi.fn().mockResolvedValue({ data: { reference: 'NQ-OOOOOO' } }) });
    await expect(runSubmission(body, [photo(1)], badSubmit, vi.fn())).rejects.toBeInstanceOf(ContractMismatch);
  });
});

describe('classifyFailure', () => {
  it('maps contract codes to what the page does', () => {
    expect(classifyFailure(problem(400, 'form_expired'))).toEqual({ kind: 'fresh-token' });
    expect(classifyFailure(problem(409, 'form_already_used'))).toEqual({ kind: 'fresh-token' });
    expect(classifyFailure(problem(401, 'form_token_invalid'))).toEqual({ kind: 'fresh-token' });
    expect(classifyFailure(problem(429, 'rate_limited'))).toEqual({ kind: 'rate-limited' });
    expect(classifyFailure(new UploadFailure([1]))).toEqual({ kind: 'upload', positions: [1] });
  });

  it('never tells which spam check refused: honeypot, time trap, outage and noise are all just "failed"', () => {
    expect(classifyFailure(problem(400, 'submission_refused'))).toEqual({ kind: 'failed' });
    expect(classifyFailure(problem(503, 'service_unavailable'))).toEqual({ kind: 'failed' });
    expect(classifyFailure(problem(500, 'internal_error'))).toEqual({ kind: 'failed' });
    expect(classifyFailure(new ApiProblem(502, '<html>Bad gateway</html>', new Headers()))).toEqual({ kind: 'failed' });
    expect(classifyFailure(new ApiNetworkError(new TypeError('Failed to fetch')))).toEqual({ kind: 'failed' });
    expect(classifyFailure(new ContractMismatch('x'))).toEqual({ kind: 'failed' });
  });

  it('keeps the field errors of a 422 and the photo positions of a photo problem', () => {
    expect(classifyFailure(problem(422, 'validation_failed', [{ field: 'phone', message: 'Enter a 10-digit phone number' }]))).toEqual({
      kind: 'validation',
      errors: [{ field: 'phone', message: 'Enter a 10-digit phone number' }],
    });
    expect(classifyFailure(problem(422, 'photo_invalid', [{ field: 'photos[2]', message: 'Photos must be JPEG, PNG or WebP' }]))).toEqual({
      kind: 'photos',
      photos: [{ position: 2, message: 'Photos must be JPEG, PNG or WebP', retryable: false }],
    });
    expect(classifyFailure(problem(422, 'photo_missing', [{ field: 'photos[1]', message: 'Upload this photo again' }]))).toEqual({
      kind: 'photos',
      photos: [{ position: 1, message: 'Upload this photo again', retryable: true }],
    });
  });

  it('a 422 with nothing to point at is just "failed"', () => {
    expect(classifyFailure(problem(422, 'validation_failed'))).toEqual({ kind: 'failed' });
    expect(classifyFailure(problem(422, 'photo_invalid'))).toEqual({ kind: 'failed' });
  });
});
