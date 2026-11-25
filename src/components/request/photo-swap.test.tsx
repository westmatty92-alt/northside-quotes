// @vitest-environment jsdom
// REV-2 / CQ-4: a storage 409 means "this photo is already uploaded" only when it is the very file this tab put at
// that path. Here the real `uploadPhoto` runs against a stand-in for the `quote-photos` bucket that answers 409 for
// an existing object, so the swap the reviewer described is reproduced end to end (form, send flow, uploader).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestForm } from '@/components/request/request-form';
import { readCompletedNonces } from '@/components/request/session-store';
import { photoFile, renderWithQuery } from '@/components/request/test-support';
import type { Problem, QuoteRequestCreate } from '@/lib/api/generated/model';
import { CreateQuoteRequestBody } from '@/lib/api/generated/public-form/public-form.zod';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

// The private bucket: an object that exists answers 409, like Storage does with `upsert: false`.
const bucket = vi.hoisted(() => ({
  objects: new Map<string, File>(),
  attempts: [] as string[],
  /** Store the next object, then answer with a network error (the reply was lost). */
  loseNextReply: false,
}));
vi.mock('@/lib/supabase/browser', () => ({
  getUploadClient: () => ({
    storage: {
      from: (name: string) => ({
        upload: async (path: string, file: File) => {
          const key = `${name}/${path}`;
          bucket.attempts.push(key);
          if (bucket.objects.has(key)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          bucket.objects.set(key, file);
          if (bucket.loseNextReply) {
            bucket.loseNextReply = false;
            return { data: null, error: { message: 'Failed to fetch' } };
          }
          return { data: { path }, error: null };
        },
      }),
    },
  }),
}));

// Each test uses its own request ids, so a path is never shared between tests.
const TOKEN = 'v1.1700000000000.6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10.c2lnbmF0dXJl';
const TOKEN_2 = 'v1.1700000009000.0b7e4d2c-1a3f-4c8e-9d6b-5e2f1a0c7b94.c2lnbmF0dXJl';
const SWAP_FIRST = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10'; // the request the failed send created
const SWAP_SECOND = '9d2e7a41-3b5c-4f68-8a10-c4e1b7f20a63'; // the request the fresh token creates
const LOST_REPLY = '3c8b1d52-7e4a-4b9f-a6d3-0f2e5c9a1b78';
const SHIFTED = 'b4a07c3e-52d1-4e86-9f0a-7d3c1e8b2a65';

const server = setupServer();
const creates: { token: string | null }[] = [];
const submits: { token: string | null; requestId: string }[] = [];

function startedFor(requestId: string, body: QuoteRequestCreate) {
  return {
    request_id: requestId,
    submission_state: 'pending',
    reference: null,
    photo_uploads: (body.photos ?? []).map(({ position, content_type }) => ({
      position,
      bucket: 'quote-photos',
      path: `${requestId}/photo-${position}`,
      content_type,
    })),
    upload_expires_at: '2026-11-19T15:10:00Z',
  };
}

/** `requestIdFor(n)` is the request the n-th create call (1-based) opens. */
function useApi(requestIdFor: (call: number) => string, submitFails: (call: number) => boolean) {
  let submitCalls = 0;
  server.use(
    http.post('*/api/quote-requests', async ({ request }) => {
      const body = CreateQuoteRequestBody.parse(await request.json());
      creates.push({ token: request.headers.get('X-Form-Token') });
      return HttpResponse.json(startedFor(requestIdFor(creates.length), body), { status: 201 });
    }),
    http.post('*/api/quote-requests/:requestId/submission', ({ request, params }) => {
      submitCalls += 1;
      submits.push({ token: request.headers.get('X-Form-Token'), requestId: String(params.requestId) });
      if (submitFails(submitCalls)) {
        const body: Problem = { type: 'about:blank', title: 'Unavailable', status: 503, code: 'service_unavailable' };
        return HttpResponse.json(body, { status: 503, headers: { 'Content-Type': 'application/problem+json' } });
      }
      return HttpResponse.json({
        request_id: String(params.requestId),
        reference: 'NQ-7K3M9P',
        submitted_at: '2026-11-19T14:10:00Z',
        photo_count: 1,
      });
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  creates.length = 0;
  submits.length = 0;
  bucket.objects.clear();
  bucket.attempts.length = 0;
  bucket.loseNextReply = false;
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

const field = (label: string) => screen.getByLabelText(label);
const send = () => screen.getByRole('button', { name: /^Send/ });
const offers = () => screen.getByRole('checkbox', { name: /Email me offers and news from Northside/ });

function fillValid() {
  fireEvent.change(field('Your name'), { target: { value: 'Dana Whitfield' } });
  fireEvent.change(field('Phone number'), { target: { value: '905-555-0142' } });
  fireEvent.change(field('Email'), { target: { value: 'dana@example.com' } });
  fireEvent.change(field('Address of the job'), { target: { value: '14 Barton St W, Hamilton ON' } });
  fireEvent.change(field("What's the problem?"), { target: { value: 'Kitchen tap drips constantly and the cabinet under it is wet' } });
  fireEvent.click(screen.getByRole('radio', { name: /Soon/ }));
}

async function addPhoto(file: File) {
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
  await screen.findByText(file.name);
}

describe('REV-2 CQ-4: a swapped photo is never skipped because of a 409', () => {
  it('a photo swapped in after a failed send (same type and size) is not treated as the one already uploaded', async () => {
    // First send: the photo uploads, then the submit fails. The second send reuses the token and the same answers
    // (and so the same request and the same upload path).
    useApi((call) => (call <= 2 ? SWAP_FIRST : SWAP_SECOND), (call) => call === 1);
    const view = renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(offers());
    const photoX = photoFile('x-under-sink.jpg', 'jpeg', 2048);
    await addPhoto(photoX);
    fireEvent.click(send());

    await waitFor(() => expect(submits).toHaveLength(1)); // the submit that failed
    expect(bucket.objects.get(`quote-photos/${SWAP_FIRST}/photo-1`)).toBe(photoX);
    await screen.findByText("We couldn't send your request. Please try again.");

    // She swaps in another photo: a different file with the same type and the same size, so the photo plan is identical.
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo x-under-sink.jpg' }));
    const photoY = photoFile('y-cabinet.jpg', 'jpeg', 2048);
    await addPhoto(photoY);
    fireEvent.click(send());

    // Storage answers 409 for photo-1 (X is there). That is not "already uploaded": Y was never stored.
    await waitFor(() => expect(bucket.attempts).toHaveLength(2));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(nav.push).not.toHaveBeenCalled();
    expect(readCompletedNonces()).toEqual([]);
    expect(submits).toHaveLength(1); // nothing was submitted with the old photo standing in for the new one
    expect(nav.refresh).toHaveBeenCalledTimes(1); // the existing "fresh token" flow

    // everything she typed and chose is still there
    expect(field('Your name')).toHaveValue('Dana Whitfield');
    expect(field('Phone number')).toHaveValue('905-555-0142');
    expect(offers()).toBeChecked();
    expect(screen.getByText('y-cabinet.jpg')).toBeInTheDocument();

    // router.refresh() hands the page a new token; she sends again and the new photo is what gets stored
    view.rerender(<RequestForm formToken={TOKEN_2} />);
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(creates.map((call) => call.token)).toEqual([TOKEN, TOKEN, TOKEN_2]);
    expect(submits.at(-1)).toEqual({ token: TOKEN_2, requestId: SWAP_SECOND });
    expect(bucket.objects.get(`quote-photos/${SWAP_SECOND}/photo-1`)).toBe(photoY);
  });

  it('a photo that moves up after another is removed is checked at its new place, not skipped as "uploaded"', async () => {
    useApi(() => SHIFTED, (call) => call === 1);
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    const photoX = photoFile('x-under-sink.jpg', 'jpeg', 2048);
    const photoZ = photoFile('z-tap.jpg', 'jpeg', 2048);
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [photoX, photoZ] } });
    await screen.findByText('z-tap.jpg');
    fireEvent.click(send());
    await waitFor(() => expect(submits).toHaveLength(1)); // both uploaded (photo-1 = X, photo-2 = Z), the submit failed
    await screen.findByText("We couldn't send your request. Please try again.");

    // X goes and W comes in: Z is now photo 1, but photo-1 in Storage still holds X. The plan is unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo x-under-sink.jpg' }));
    await addPhoto(photoFile('w-cabinet.jpg', 'jpeg', 2048));
    bucket.attempts.length = 0;
    fireEvent.click(send());

    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(bucket.attempts).toContain(`quote-photos/${SHIFTED}/photo-1`); // Z was sent again, not assumed to be there
    expect(nav.push).not.toHaveBeenCalled();
    expect(submits).toHaveLength(1);
  });

  it('the same photo retried after a lost reply is still "already uploaded": no new token, no second copy', async () => {
    useApi(() => LOST_REPLY, () => false);
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    const photoX = photoFile('x-under-sink.jpg', 'jpeg', 2048);
    await addPhoto(photoX);

    bucket.loseNextReply = true; // stored, but the answer never arrives
    fireEvent.click(send());
    await screen.findByText("This photo didn't upload. Check your connection, then tap Send request to try again.");
    expect(bucket.objects.get(`quote-photos/${LOST_REPLY}/photo-1`)).toBe(photoX);

    fireEvent.click(send()); // 409 for the very same file
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(bucket.attempts).toHaveLength(2);
    expect(creates.map((call) => call.token)).toEqual([TOKEN, TOKEN]);
    expect(nav.refresh).toHaveBeenCalledTimes(1); // only the one after the completed send
    expect(bucket.objects.get(`quote-photos/${LOST_REPLY}/photo-1`)).toBe(photoX);
  });
});
