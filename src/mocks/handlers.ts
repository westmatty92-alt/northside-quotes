// The mock API: the public form's three calls (below) plus the staff screens' (staff-handlers.ts), the same calls the
// real backend and Storage answer, with the contract's statuses and problem+json bodies. The submit call is the generated MSW handler; create and the Storage upload are
// written here because the generated create handler can only answer 200 and Storage is excluded from the generated
// client. Like the real API, create refuses a missing form token (401), a filled honeypot (400, the one generic
// body) and answers in 201 for a new pending request.
import { HttpResponse, http, type RequestHandler } from 'msw';
import type { Problem, ProblemCode, QuoteRequestStarted } from '@/lib/api/generated/model';
import { CreateQuoteRequestBody } from '@/lib/api/generated/public-form/public-form.zod';
import { getSubmitQuoteRequestMockHandler } from '@/lib/api/generated/public-form/public-form.msw';
import type { Scenario } from '@/mocks/scenarios';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

const REQUEST_ID = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
const REFERENCE = 'NQ-7K3M9P';
const GENERIC_FAILURE = "We couldn't send your request. Please try again.";

function problem(status: number, code: ProblemCode, title: string, errors?: Problem['errors'], headers?: Record<string, string>) {
  const body: Problem = { type: 'about:blank', title, status, code, ...(errors ? { errors } : {}) };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json', ...headers } });
}

export function buildHandlers(scenario: Scenario): RequestHandler[] {
  let createCalls = 0;
  let plannedPhotos = 0;

  const create = http.post('*/api/quote-requests', async ({ request }) => {
    createCalls += 1;
    if (!request.headers.get('X-Form-Token')) return problem(401, 'form_token_invalid', GENERIC_FAILURE);

    const parsed = CreateQuoteRequestBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const errors = parsed.error.issues.flatMap((issue) =>
        typeof issue.path[0] === 'string' ? [{ field: issue.path[0], message: issue.message }] : [],
      );
      return problem(422, 'validation_failed', 'Some answers need fixing', errors);
    }
    if (parsed.data.website) return problem(400, 'submission_refused', GENERIC_FAILURE);

    if (scenario === 'send-failed') return problem(503, 'service_unavailable', GENERIC_FAILURE);
    if (scenario === 'rate-limited') {
      return problem(429, 'rate_limited', 'Too many requests. Please try again in a few minutes.', undefined, { 'Retry-After': '300' });
    }
    if (scenario === 'form-expired' && createCalls === 1) return problem(400, 'form_expired', GENERIC_FAILURE);

    plannedPhotos = parsed.data.photos.length;
    const started: QuoteRequestStarted = {
      request_id: REQUEST_ID,
      submission_state: 'pending',
      reference: null,
      photo_uploads: parsed.data.photos.map(({ position, content_type }) => ({
        position,
        bucket: 'quote-photos',
        path: `${REQUEST_ID}/photo-${position}`,
        content_type,
      })),
      upload_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    return HttpResponse.json(started, { status: 201 });
  });

  // uploadQuotePhoto, which Supabase Storage answers (supabase-js posts to {project}/storage/v1/object/...)
  const upload = http.post('*/storage/v1/object/quote-photos/*', ({ request }) => {
    const path = new URL(request.url).pathname.replace(/^.*\/object\//, '');
    if (scenario === 'upload-failed' && path.endsWith('/photo-2')) {
      return HttpResponse.json({ statusCode: '500', error: 'Internal Server Error', message: 'The upload failed' }, { status: 500 });
    }
    return HttpResponse.json({ Key: path });
  });

  const submit = getSubmitQuoteRequestMockHandler(() => ({
    request_id: REQUEST_ID,
    reference: REFERENCE,
    submitted_at: new Date().toISOString(),
    photo_count: plannedPhotos,
  }));

  return [create, upload, submit, ...buildStaffHandlers(scenario)];
}
