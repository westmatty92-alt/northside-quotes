// @vitest-environment jsdom
// SCR-01: every designed state, the send, and what happens to the form token. API calls go through msw (the same
// contract statuses the mock layer uses); the next router and the supabase-js uploader are the only stand-ins.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormPreviewContext } from '@/components/request/preview-context';
import { RequestForm } from '@/components/request/request-form';
import { parseReceipt, readCompletedNonces } from '@/components/request/session-store';
import { expectNoAxeViolations, photoFile, renderWithQuery } from '@/components/request/test-support';
import type { Problem, ProblemCode, QuoteRequestCreate, QuoteRequestStarted } from '@/lib/api/generated/model';
import { CreateQuoteRequestBody } from '@/lib/api/generated/public-form/public-form.zod';
import { buildHandlers } from '@/mocks/handlers';
import { previewFor } from '@/mocks/previews';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const uploader = vi.hoisted(() => ({ uploadPhoto: vi.fn() }));
vi.mock('@/components/request/photo-upload', () => uploader);

const NONCE = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
const NONCE_2 = '0b7e4d2c-1a3f-4c8e-9d6b-5e2f1a0c7b94';
const TOKEN = `v1.1700000000000.${NONCE}.c2lnbmF0dXJl`;
const TOKEN_2 = `v1.1700000009000.${NONCE_2}.c2lnbmF0dXJl`;
const REQUEST_ID = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';

const server = setupServer();
const creates: { token: string | null; body: QuoteRequestCreate }[] = [];
const submits: { token: string | null }[] = [];

function problem(status: number, code: ProblemCode, title: string, errors?: Problem['errors']) {
  const body: Problem = { type: 'about:blank', title, status, code, ...(errors ? { errors } : {}) };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

function started(body: QuoteRequestCreate, state: 'pending' | 'submitted' = 'pending'): QuoteRequestStarted {
  return {
    request_id: REQUEST_ID,
    submission_state: state,
    reference: state === 'submitted' ? 'NQ-7K3M9P' : null,
    photo_uploads: (body.photos ?? []).map(({ position, content_type }) => ({
      position,
      bucket: 'quote-photos',
      path: `${REQUEST_ID}/photo-${position}`,
      content_type,
    })),
    upload_expires_at: state === 'pending' ? '2026-11-19T15:10:00Z' : null,
  };
}

/** The create call, recording what it was sent. `respond` decides the answer (default: 201 pending). */
function createHandler(respond?: (call: number, body: QuoteRequestCreate) => Response | Promise<Response>) {
  return http.post('*/api/quote-requests', async ({ request }) => {
    const body = CreateQuoteRequestBody.parse(await request.json());
    creates.push({ token: request.headers.get('X-Form-Token'), body });
    return respond ? respond(creates.length, body) : HttpResponse.json(started(body), { status: 201 });
  });
}

function submitHandler(respond?: () => Response | Promise<Response>) {
  return http.post('*/api/quote-requests/:requestId/submission', async ({ request }) => {
    submits.push({ token: request.headers.get('X-Form-Token') });
    return (
      respond?.() ??
      HttpResponse.json({
        request_id: REQUEST_ID,
        reference: 'NQ-7K3M9P',
        submitted_at: '2026-11-19T14:10:00Z',
        photo_count: creates.at(-1)?.body.photos?.length ?? 0,
      })
    );
  });
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  creates.length = 0;
  submits.length = 0;
  uploader.uploadPhoto.mockResolvedValue(undefined);
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
const photoInput = () => screen.getByTestId('photo-input');

function fillValid(overrides: Partial<Record<'name' | 'phone' | 'email' | 'address' | 'problem', string>> = {}) {
  const values = {
    name: 'Dana Whitfield',
    phone: '905-555-0142',
    email: 'dana@example.com',
    address: '14 Barton St W, Hamilton ON',
    problem: 'Kitchen tap drips constantly and the cabinet under it is wet',
    ...overrides,
  };
  fireEvent.change(field('Your name'), { target: { value: values.name } });
  fireEvent.change(field('Phone number'), { target: { value: values.phone } });
  fireEvent.change(field('Email'), { target: { value: values.email } });
  fireEvent.change(field('Address of the job'), { target: { value: values.address } });
  fireEvent.change(field("What's the problem?"), { target: { value: values.problem } });
  fireEvent.click(screen.getByRole('radio', { name: /Soon/ }));
}

async function addPhotos(...files: File[]) {
  fireEvent.change(photoInput(), { target: { files } });
  await screen.findByText(files[0]?.name ?? '');
}

describe('SCR-01 states', () => {
  it('Empty: a blank form, nothing preselected, the offers box unticked, no photos', () => {
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Request a quote' })).toBeInTheDocument();
    for (const input of ['Your name', 'Phone number', 'Email', 'Address of the job', "What's the problem?"]) {
      expect(field(input)).toHaveValue('');
    }
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(offers()).not.toBeChecked();
    expect(screen.queryByRole('list', { name: 'Attached photos' })).not.toBeInTheDocument();
    expect(send()).toHaveTextContent('Send request');
    expect(screen.getByText(/Northside will use these details to reply to your quote request/)).toBeInTheDocument();

    // the honeypot is invisible to everyone: out of the tab order and out of the accessibility tree
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
  });

  it('Empty has no accessibility violations', async () => {
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    await expectNoAxeViolations(container);
  });

  it('unticks the offers box on load even if something ticked it first', () => {
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    expect(container.querySelector<HTMLInputElement>('#offers')?.checked).toBe(false);
    fireEvent.click(offers());
    expect(offers()).toBeChecked();
    fireEvent.click(offers());
    expect(offers()).not.toBeChecked();
  });

  it('Error: a refused Send shows the summary and a message under each field, makes no request, and keeps the offers tick', async () => {
    server.use(createHandler());
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    fireEvent.change(field('Your name'), { target: { value: 'Dana Whitfield' } });
    fireEvent.change(field('Phone number'), { target: { value: '12345' } });
    fireEvent.change(field('Email'), { target: { value: 'dana@' } });
    fireEvent.change(field('Address of the job'), { target: { value: '14 Barton St W, Hamilton ON' } });
    fireEvent.change(field("What's the problem?"), { target: { value: 'Tap leaks' } });
    fireEvent.click(offers());
    fireEvent.click(send());

    const summaryTitle = await screen.findByText('Your request has not been sent. Fix these 4 things:');
    const summary = summaryTitle.closest('[role="alert"]');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(within(summary as HTMLElement).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Phone number: enter a 10-digit number',
      'Email: enter a valid address',
      "What's the problem: use 10 to 2,000 characters",
      'How urgent is it: choose one',
    ]);

    expect(field('Phone number')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Phone number')).toHaveAccessibleDescription('Enter a 10-digit phone number, like 905-555-0142.');
    expect(field('Email')).toHaveAccessibleDescription('Enter an email address like name@example.com.');
    expect(field("What's the problem?")).toHaveAccessibleDescription(
      'Describe the problem in 10 to 2,000 characters. You have written 9.',
    );
    expect(screen.getByRole('group', { name: 'How urgent is it?' })).toHaveAccessibleDescription('Choose how urgent it is.');
    expect(field('Your name')).not.toHaveAttribute('aria-invalid');

    // what she typed and the offers box stay exactly as she left them (AC-001.16)
    expect(field('Phone number')).toHaveValue('12345');
    expect(field('Email')).toHaveValue('dana@');
    expect(offers()).toBeChecked();
    expect(creates).toHaveLength(0);

    // a summary link moves focus to its field
    fireEvent.click(within(summary as HTMLElement).getByRole('link', { name: /Phone number/ }));
    expect(document.activeElement).toBe(field('Phone number'));
    await expectNoAxeViolations(container);
  });

  it('Error: a problem of 2,001 characters says how many were written', async () => {
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid({ problem: 'x'.repeat(2001) });
    fireEvent.click(send());
    expect(await screen.findByText('Describe the problem in 10 to 2,000 characters. You have written 2001.')).toBeInTheDocument();
  });

  it('Loading: Sending is paused, a second tap makes no second request, and success goes to SCR-02', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      createHandler(async (_call, body) => {
        await gate;
        return HttpResponse.json(started(body), { status: 201 });
      }),
      submitHandler(),
    );
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());

    const sending = await screen.findByRole('button', { name: 'Sending' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Sending your request');
    fireEvent.click(sending);
    fireEvent.click(sending);
    release();

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(creates).toHaveLength(1);
    expect(submits).toHaveLength(1);
  });

  it('Success: sends the answers with the token and a real boolean for the offers box, then drops the token and refreshes', async () => {
    server.use(createHandler(), submitHandler());
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid({ name: '  Dana Whitfield ' });
    fireEvent.click(offers());
    fireEvent.click(send());

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(creates[0]?.token).toBe(TOKEN);
    expect(submits[0]?.token).toBe(TOKEN);
    expect(creates[0]?.body).toEqual({
      name: 'Dana Whitfield',
      phone: '905-555-0142',
      email: 'dana@example.com',
      address: '14 Barton St W, Hamilton ON',
      problem: 'Kitchen tap drips constantly and the cabinet under it is wet',
      urgency: 'soon',
      marketing_consent: true,
      website: '',
      photos: [],
    });

    // the token is dropped (its nonce is remembered) and a new one is fetched
    expect(readCompletedNonces()).toEqual([NONCE]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(parseReceipt(window.sessionStorage.getItem('nq.receipt') ?? '')).toEqual({
      reference: 'NQ-7K3M9P',
      firstName: 'Dana',
      phone: '905-555-0142',
      address: '14 Barton St W, Hamilton ON',
      urgency: 'soon',
      photoCount: 0,
    });
  });

  it('sends the offers choice as false when the box was never touched', async () => {
    server.use(createHandler(), submitHandler());
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(creates[0]?.body.marketing_consent).toBe(false);
  });

  it('Error: the database being down shows the one generic failure, keeps everything, and Send works again', async () => {
    server.use(createHandler(() => problem(503, 'service_unavailable', "We couldn't send your request. Please try again.")));
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(offers());
    fireEvent.click(send());

    const title = await screen.findByText("We couldn't send your request. Please try again.");
    await waitFor(() => expect(document.activeElement).toBe(title.closest('[role="alert"]')));
    expect(screen.getByText(/Nothing was sent and no reference number was issued/)).toBeInTheDocument();
    expect(field('Your name')).toHaveValue('Dana Whitfield');
    expect(offers()).toBeChecked();
    expect(send()).toHaveTextContent('Send request');
    expect(send()).not.toHaveAttribute('aria-disabled');
    expect(nav.push).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);

    server.use(createHandler(), submitHandler());
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
  });

  it('Error: a honeypot or too-fast refusal reads exactly like any other failure', async () => {
    server.use(createHandler(() => problem(400, 'submission_refused', "We couldn't send your request. Please try again.")));
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());
    expect(await screen.findByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
    // no token refresh for a refusal: a brand-new token would only be too young again
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('Error: the sixth send in ten minutes says so', async () => {
    server.use(createHandler(() => problem(429, 'rate_limited', 'Too many requests. Please try again in a few minutes.')));
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());
    expect(await screen.findByText('Too many requests. Please try again in a few minutes.')).toBeInTheDocument();
    expect(field('Your name')).toHaveValue('Dana Whitfield');
  });

  it('Error: the server refusing an answer lands on that field, with the summary', async () => {
    server.use(
      createHandler(() =>
        problem(422, 'validation_failed', 'Some answers need fixing', [
          { field: 'phone', message: 'Enter a 10-digit phone number' },
        ]),
      ),
    );
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());
    expect(await screen.findByText('Your request has not been sent. Fix this:')).toBeInTheDocument();
    expect(field('Phone number')).toHaveAccessibleDescription('Enter a 10-digit phone number');
    expect(field('Phone number')).toHaveValue('905-555-0142');
  });
});

describe('the form token', () => {
  it.each([
    ['400 form_expired', 400, 'form_expired'],
    ['409 form_already_used', 409, 'form_already_used'],
  ] as const)('%s: refreshes the token, keeps every typed value and the offers box, and she sends again with the new one', async (_name, status, code) => {
    let first = true;
    server.use(
      createHandler((_call, body) => {
        if (first) {
          first = false;
          return problem(status, code, "We couldn't send your request. Please try again.");
        }
        return HttpResponse.json(started(body), { status: 201 });
      }),
      submitHandler(),
    );
    const view = renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(offers());
    fireEvent.click(send());

    expect(await screen.findByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(field('Phone number')).toHaveValue('905-555-0142');
    expect(offers()).toBeChecked();

    // router.refresh() hands the same page a new token; the typed values live on
    view.rerender(<RequestForm formToken={TOKEN_2} />);
    expect(field('Phone number')).toHaveValue('905-555-0142');
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(creates.map((call) => call.token)).toEqual([TOKEN, TOKEN_2]);
    expect(submits[0]?.token).toBe(TOKEN_2);
    expect(creates[1]?.body.marketing_consent).toBe(true);
  });

  it('a token that already completed a send is dropped: no request goes out with it', async () => {
    window.sessionStorage.setItem('nq.completed-form-nonces', JSON.stringify([NONCE]));
    server.use(createHandler(), submitHandler());
    renderWithQuery(<RequestForm formToken={TOKEN} />);

    // on mount, a page whose token is listed refreshes first
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    fillValid();
    fireEvent.click(send());
    expect(await screen.findByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
    expect(creates).toHaveLength(0);
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it('on pageshow from the back/forward cache, a listed token refreshes first and the offers box starts unticked', async () => {
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fireEvent.click(offers());
    expect(nav.refresh).not.toHaveBeenCalled();

    window.sessionStorage.setItem('nq.completed-form-nonces', JSON.stringify([NONCE]));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(offers()).not.toBeChecked();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it('a token that is not listed is left alone on mount and on pageshow', () => {
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('a 200 for a token that was already submitted goes straight to SCR-02 with that reference', async () => {
    server.use(createHandler((_call, body) => HttpResponse.json(started(body, 'submitted'), { status: 200 })), submitHandler());
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    fillValid();
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(submits).toHaveLength(0);
    expect(parseReceipt(window.sessionStorage.getItem('nq.receipt') ?? '')?.reference).toBe('NQ-7K3M9P');
    expect(readCompletedNonces()).toEqual([NONCE]);
    expect(nav.refresh).toHaveBeenCalled();
  });
});

describe('photos', () => {
  it('lists a photo with its name, size and a Remove button that names the file, and removes it', async () => {
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    await addPhotos(photoFile('under-sink-1.jpg', 'jpeg', 2 * 1_048_576));
    const row = screen.getByText('under-sink-1.jpg').closest('li') as HTMLElement;
    expect(within(row).getByText('2.0 MB')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove photo under-sink-1.jpg' }));
    expect(screen.queryByText('under-sink-1.jpg')).not.toBeInTheDocument();
  });

  it('Disabled: at 3 photos "Add a photo" is paused with the words beside it, and a 4th is not added', async () => {
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    await addPhotos(photoFile('a.jpg'), photoFile('b.png', 'png'), photoFile('c.webp', 'webp'));
    await screen.findByText('You can add up to 3 photos');
    const add = screen.getByRole('button', { name: 'Add a photo' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAccessibleDescription('You can add up to 3 photos');

    fireEvent.change(photoInput(), { target: { files: [photoFile('d.jpg')] } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('d.jpg')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('refuses a PDF, a renamed text file and a photo over 5 MB, shows why, and blocks Send until they are removed', async () => {
    server.use(createHandler(), submitHandler());
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    const renamed = new File([new TextEncoder().encode('just some notes')], 'notes.jpg', { type: 'image/jpeg' });
    fireEvent.change(photoInput(), {
      target: { files: [photoFile('plumber-quote.pdf', 'pdf'), renamed, photoFile('IMG_4410.jpg', 'jpeg', 5_242_881)] },
    });
    await screen.findByText('IMG_4410.jpg');
    expect(screen.getAllByText('Photos must be JPEG, PNG or WebP')).toHaveLength(2);
    expect(screen.getByText('Each photo must be 5 MB or smaller')).toBeInTheDocument();
    // refused files are not photos: "Add a photo" is still available
    expect(screen.getByRole('button', { name: 'Add a photo' })).not.toHaveAttribute('aria-disabled');

    fillValid();
    fireEvent.click(send());
    const summary = (await screen.findByText('Your request has not been sent. Fix this:')).closest('[role="alert"]');
    expect(within(summary as HTMLElement).getByRole('link')).toHaveTextContent('Photos: 3 photos were refused');
    expect(creates).toHaveLength(0);
    await expectNoAxeViolations(container);

    for (const name of ['plumber-quote.pdf', 'notes.jpg', 'IMG_4410.jpg']) {
      fireEvent.click(screen.getByRole('button', { name: `Remove photo ${name}` }));
    }
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
  });

  it('Loading: each photo row says how far its upload got, in words; success sends the plan and every file', async () => {
    const releases: Array<() => void> = [];
    uploader.uploadPhoto.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    server.use(createHandler(), submitHandler());
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    await addPhotos(photoFile('a.jpg', 'jpeg', 1000), photoFile('b.png', 'png', 2000));
    await screen.findByText('b.png');
    fillValid();
    fireEvent.click(send());

    expect(await screen.findByText('Uploading 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Uploading 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo a.jpg' })).toHaveAttribute('aria-disabled', 'true');
    for (const release of releases) release();

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(creates[0]?.body.photos).toEqual([
      { position: 1, content_type: 'image/jpeg', size_bytes: 1000 },
      { position: 2, content_type: 'image/png', size_bytes: 2000 },
    ]);
    expect(uploader.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(uploader.uploadPhoto.mock.calls[0]?.[0]).toMatchObject({ bucket: 'quote-photos', path: `${REQUEST_ID}/photo-1` });
  });

  it('Error: a photo that did not upload shows its error beside it, keeps the form, and a retry sends only that photo', async () => {
    uploader.uploadPhoto.mockImplementation(async (_target: unknown, photo: { position: number }) => {
      if (photo.position === 2 && uploader.uploadPhoto.mock.calls.length <= 3) throw new Error('network');
    });
    server.use(createHandler(), submitHandler());
    const { container } = renderWithQuery(<RequestForm formToken={TOKEN} />);
    await addPhotos(photoFile('a.jpg'), photoFile('b.jpg'), photoFile('c.jpg'));
    await screen.findByText('c.jpg');
    fillValid();
    fireEvent.click(send());

    expect(await screen.findByText("This photo didn't upload. Check your connection, then tap Send request to try again.")).toBeInTheDocument();
    expect(screen.getByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
    expect(screen.getByText('a.jpg').closest('li')).toHaveTextContent('uploaded');
    expect(nav.push).not.toHaveBeenCalled();
    expect(submits).toHaveLength(0);
    await expectNoAxeViolations(container);

    // the same token and the same answers: photos already in Storage are not sent again
    fireEvent.click(send());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/request-sent'));
    expect(uploader.uploadPhoto).toHaveBeenCalledTimes(4);
    expect(uploader.uploadPhoto.mock.calls[3]?.[1]).toMatchObject({ position: 2 });
    expect(creates).toHaveLength(2);
  });

  it('Error: a photo the server refuses after upload is flagged beside the photo and must be removed', async () => {
    server.use(
      createHandler(),
      submitHandler(() =>
        problem(422, 'photo_invalid', 'A photo could not be used', [{ field: 'photos[1]', message: 'Photos must be JPEG, PNG or WebP' }]),
      ),
    );
    renderWithQuery(<RequestForm formToken={TOKEN} />);
    await addPhotos(photoFile('a.jpg'), photoFile('b.jpg'));
    await screen.findByText('b.jpg');
    fillValid();
    fireEvent.click(send());

    expect(await screen.findByText('Your request has not been sent. Fix this:')).toBeInTheDocument();
    expect(screen.getByText('a.jpg').closest('li')).toHaveTextContent('Photos must be JPEG, PNG or WebP');
    expect(screen.getByText('b.jpg').closest('li')).not.toHaveTextContent('Photos must be');
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('scenario seeds (mock mode)', () => {
  it('errors: refused values and photos show their messages on load, no request is made, the offers box stays ticked', async () => {
    server.use(...buildHandlers('errors'));
    const { container } = renderWithQuery(
      <FormPreviewContext value={previewFor('errors')}>
        <RequestForm formToken={TOKEN} />
      </FormPreviewContext>,
    );
    expect(await screen.findByText(/Your request has not been sent\. Fix these 5 things:/)).toBeInTheDocument();
    expect(screen.getByText('Photos: 2 photos were refused')).toBeInTheDocument();
    expect(offers()).toBeChecked();
    expect(field('Phone number')).toHaveValue('12345');
    expect(screen.getByText('Photos must be JPEG, PNG or WebP')).toBeInTheDocument();
    expect(screen.getByText('Each photo must be 5 MB or smaller')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('send-failed: sends once on load, the API answers 503, the failure banner shows with every value and photo kept', async () => {
    server.use(...buildHandlers('send-failed'));
    const { container } = renderWithQuery(
      <FormPreviewContext value={previewFor('send-failed')}>
        <RequestForm formToken={TOKEN} />
      </FormPreviewContext>,
    );
    expect(await screen.findByText("We couldn't send your request. Please try again.")).toBeInTheDocument();
    expect(field('Your name')).toHaveValue('Dana Whitfield');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('You can add up to 3 photos')).toBeInTheDocument();
    expect(offers()).not.toBeChecked();
    await expectNoAxeViolations(container);
  });
});
