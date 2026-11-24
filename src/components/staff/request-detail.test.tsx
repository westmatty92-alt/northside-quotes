// @vitest-environment jsdom
// SCR-06: the request in every designed state, the price and note (validation, saved, could not save, changed by someone
// else, session ended), the status control, and the GoHighLevel card (waiting, failed, retry, no offers consent). The API is
// the mock API through msw, with overrides.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestDetail } from '@/components/staff/request-detail';
import { expectNoAxeViolations, installDialogStandIn, renderStaff } from '@/components/staff/test-support';
import type { Problem, ProblemCode } from '@/lib/api/generated/model';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

vi.mock('next/navigation', () => ({ usePathname: () => '/requests/mock-1', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
const go = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/components/staff/navigation', () => go);

const server = setupServer();
const saves: Array<{ price_cents: number | null; note: string | null; version: number }> = [];
const changes: Array<{ to_status: string; version: number }> = [];
let retries = 0;

beforeAll(() => {
  installDialogStandIn();
  server.listen({ onUnhandledFrame: 'error' });
});
beforeEach(() => {
  saves.length = 0;
  changes.length = 0;
  retries = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const TOMASZ = 'a0000000-0000-4000-8000-000000000004'; // no photos, copy waiting
const PRIYA = 'a0000000-0000-4000-8000-000000000003'; // copy failed

function problem(status: number, code: ProblemCode, title: string) {
  const body: Problem = { type: 'about:blank', title, status, code };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

/** The mock API, recording what the screen sends. */
function useMock(scenario: Parameters<typeof buildStaffHandlers>[0] = 'signed-in') {
  server.use(
    http.put('*/api/quote-requests/:id/quote', async ({ request }) => {
      saves.push((await request.clone().json()) as (typeof saves)[number]);
      return undefined;
    }),
    http.post('*/api/quote-requests/:id/status-changes', async ({ request }) => {
      changes.push((await request.clone().json()) as (typeof changes)[number]);
      return undefined;
    }),
    http.post('*/api/quote-requests/:id/ghl-copy-retries', () => {
      retries += 1;
      return undefined;
    }),
    ...buildStaffHandlers(scenario),
  );
}

async function open(id = 'mock-1', tab: 'requests' | 'pipeline' = 'requests') {
  const view = renderStaff(<RequestDetail requestId={id} tab={tab} />);
  await screen.findByRole('heading', { level: 1 });
  return view;
}

const price = () => screen.getByLabelText(/Price quoted, in Canadian dollars/);
const note = () => screen.getByLabelText(/^Note/);
const save = () => fireEvent.click(screen.getByRole('button', { name: /Save price and note|Try saving again/ }));

describe('SCR-06 Request detail', () => {
  describe('the request', () => {
    it('Success (ticked, three photos): the job tag, name, status, urgency, time, contact links, every field, and the one primary button', async () => {
      useMock();
      const { container } = await open();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dana Whitfield');
      expect(screen.getByRole('img', { name: 'Reference number N Q, 7, K, 3, M, 9, P' })).toHaveTextContent('NQ-7K3M9P');
      expect(screen.getByText('Submitted Nov 19, 9:10 a.m. (Hamilton time)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Call 905-555-0142' })).toHaveAttribute('href', 'tel:+19055550142');
      expect(screen.getByRole('link', { name: 'Email Dana' })).toHaveAttribute('href', 'mailto:dana@example.com');
      expect(screen.getByRole('link', { name: 'dana@example.com' })).toBeInTheDocument();
      expect(screen.getByText('14 Barton St W, Hamilton ON')).toBeInTheDocument();
      expect(screen.getByText('Within the next few days')).toBeInTheDocument();
      expect(screen.getByText('Kitchen tap drips constantly and the cabinet under it is wet')).toBeInTheDocument();
      expect(screen.getByText('Not updated yet')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^View photo \d of 3 at full size$/ })).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Save price and note' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });

    it('opened from the Pipeline tab it says "Back to Pipeline" and goes there', async () => {
      useMock();
      await open('mock-1', 'pipeline');
      expect(screen.getByRole('link', { name: 'Back to Pipeline' })).toHaveAttribute('href', '/pipeline');
    });

    it('opened from the Requests tab it says "Back to Requests" and goes there', async () => {
      useMock();
      await open('mock-1', 'requests');
      expect(screen.getByRole('link', { name: 'Back to Requests' })).toHaveAttribute('href', '/requests');
    });

    it('text from the homeowner is drawn as plain text, never as markup (AC-001.5)', async () => {
      server.use(
        http.get('*/api/quote-requests/:id', () =>
          HttpResponse.json({
            id: 'a0000000-0000-4000-8000-000000000001', reference: 'NQ-7K3M9P', name: '<img src=x onerror=alert(1)>', phone: '9055550142',
            email: 'dana@example.com', address: '14 Barton St W', problem: '<script>alert(1)</script> and a leaking tap', urgency: 'soon', status: 'new',
            status_changed_at: null, submitted_at: '2026-11-19T14:10:00Z', price_cents: null, currency: 'CAD', note: null, photo_count: 0, photos: [],
            last_updated: null, marketing_consent: false, marketing_consent_at: null, ghl: { copy: { state: 'not_copied_no_consent', at: null }, stage_tag: null }, version: 1,
          }),
        ),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = await open();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<img src=x onerror=alert(1)>');
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img[src="x"]')).toBeNull();
      expect(screen.getByText('<script>alert(1)</script> and a leaking tap')).toBeInTheDocument();
    });

    it('Loading: a skeleton in the real layout, the page busy, "Loading the request" announced', async () => {
      let release: () => void = () => undefined;
      server.use(
        http.get('*/api/quote-requests/:id', async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = renderStaff(<RequestDetail requestId="mock-1" tab="requests" />);
      expect(screen.getByRole('status')).toHaveTextContent('Loading the request');
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByRole('link', { name: 'Back to Requests' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
      release();
      expect(await screen.findByRole('heading', { level: 1, name: 'Dana Whitfield' })).toBeInTheDocument();
    });

    it('Error: "Couldn\'t load this request. Try again." with a retry that loads it', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/quote-requests/:id', () => {
          calls += 1;
          return calls === 1 ? problem(500, 'internal_error', 'Something went wrong') : undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = renderStaff(<RequestDetail requestId="mock-1" tab="requests" />);
      expect(await screen.findByText("Couldn't load this request. Try again.")).toBeInTheDocument();
      await expectNoAxeViolations(container);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Dana Whitfield' })).toBeInTheDocument();
    });

    it('an unknown or pending request: "This request was not found." with the way back', async () => {
      useMock();
      renderStaff(<RequestDetail requestId="mock-404" tab="requests" />);
      expect(await screen.findByRole('heading', { name: 'This request was not found.' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to Requests' })).toBeInTheDocument();
    });

    it('a request that breaks the contract shows the "can\'t load" state, not a crash', async () => {
      server.use(http.get('*/api/quote-requests/:id', () => HttpResponse.json({ id: 'nope' })), ...buildStaffHandlers('signed-in'));
      renderStaff(<RequestDetail requestId="mock-1" tab="requests" />);
      expect(await screen.findByText("Couldn't load this request. Try again.")).toBeInTheDocument();
    });

    it('Empty: no photos says so (a dashed panel, no thumbnails)', async () => {
      useMock();
      const { container } = await open(TOMASZ);
      expect(screen.getByText('No photos')).toBeInTheDocument();
      expect(screen.getByText(/The homeowner did not attach any/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('Photo storage unreachable: every slot says "Photo unavailable" and the rest of the request is shown', async () => {
      server.use(
        http.get('*/api/quote-requests/:id', () => {
          return HttpResponse.json({
            id: 'a0000000-0000-4000-8000-000000000001', reference: 'NQ-7K3M9P', name: 'Dana Whitfield', phone: '9055550142', email: 'dana@example.com',
            address: '14 Barton St W, Hamilton ON', problem: 'Kitchen tap drips constantly', urgency: 'soon', status: 'new', status_changed_at: null,
            submitted_at: '2026-11-19T14:10:00Z', price_cents: null, currency: 'CAD', note: null, photo_count: 3,
            photos: [1, 2, 3].map((position) => ({ position, content_type: 'image/jpeg', url: null, expires_at: null })), last_updated: null,
            marketing_consent: true, marketing_consent_at: '2026-11-19T14:10:00Z',
            ghl: { copy: { state: 'copied', at: '2026-11-19T14:11:00Z' }, stage_tag: { state: 'up_to_date', at: null } }, version: 1,
          });
        }),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = await open();
      expect(screen.getAllByText('Photo unavailable')).toHaveLength(3);
      expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
      expect(screen.getByText(/Reload the page to try the photos again/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Dana Whitfield' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });
  });

  describe('GoHighLevel', () => {
    it('copied: "Copied to GoHighLevel" with the time, and "Stage tag up to date"; no Retry', async () => {
      useMock();
      await open();
      const card = screen.getByRole('region', { name: 'GoHighLevel' });
      expect(within(card).getByText(/Copied to GoHighLevel/)).toBeInTheDocument();
      expect(within(card).getByText('Nov 19, 9:10 a.m.')).toBeInTheDocument();
      expect(within(card).getByText('Stage tag up to date')).toBeInTheDocument();
      expect(within(card).queryByRole('button')).toBeNull();
    });

    it('NOT ticked: one line "Not copied: no offers consent", no Retry control at all, no stage tag line (AC-010.6, AC-014.4, AC-017.16)', async () => {
      useMock();
      const { container } = await open('mock-2');
      const card = screen.getByRole('region', { name: 'GoHighLevel' });
      expect(within(card).getByText('Not copied: no offers consent')).toBeInTheDocument();
      expect(within(card).getByText(/nothing is sent to GoHighLevel for this request, now or when its status changes/)).toBeInTheDocument();
      expect(within(card).queryByRole('button')).toBeNull();
      expect(within(card).queryByText(/Retry/)).toBeNull();
      expect(within(card).queryByText(/Stage tag/i)).toBeNull();
      expect(within(card).queryByText('CONTACT COPY')).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('NOT ticked stays the same in every status (no stage tag line after a status change either)', async () => {
      useMock();
      await open('mock-2');
      fireEvent.click(screen.getByRole('button', { name: 'Won' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Won' })).toHaveAttribute('aria-pressed', 'true'));
      await waitFor(() => expect(changes).toHaveLength(1));
      const card = screen.getByRole('region', { name: 'GoHighLevel' });
      expect(within(card).getByText('Not copied: no offers consent')).toBeInTheDocument();
      expect(within(card).queryByText(/Stage tag/i)).toBeNull();
      expect(within(card).queryByRole('button')).toBeNull();
    });

    it('waiting to retry: both lines say so, the request stays editable, and there is no Retry yet', async () => {
      useMock();
      await open(TOMASZ);
      const card = screen.getByRole('region', { name: 'GoHighLevel' });
      expect(within(card).getByText('Waiting to retry')).toBeInTheDocument();
      expect(within(card).getByText('Stage tag waiting to retry')).toBeInTheDocument();
      expect(within(card).queryByRole('button')).toBeNull();
      expect(screen.getByRole('button', { name: 'Save price and note' })).not.toHaveAttribute('aria-disabled');
    });

    it('failed: "Copy to GoHighLevel failed" with the time of the last try and a Retry copy button; the stage tag failed too', async () => {
      useMock();
      const { container } = await open(PRIYA);
      const card = screen.getByRole('region', { name: 'GoHighLevel' });
      expect(within(card).getByText(/Copy to GoHighLevel failed/)).toBeInTheDocument();
      expect(within(card).getAllByText(/Last tried Nov 18, 4:15 p\.m\./)).toHaveLength(2);
      expect(within(card).getByText('Stage tag failed')).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Retry copy' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });

    it('Retry copy: reads "Retrying" and is paused while it runs (a double click makes one try), then it is copied', async () => {
      let release: () => void = () => undefined;
      server.use(
        http.post('*/api/quote-requests/:id/ghl-copy-retries', async () => {
          retries += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      await open(PRIYA);
      fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
      const busy = await screen.findByRole('button', { name: 'Retrying' });
      expect(busy).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(busy);
      fireEvent.click(busy);
      release();
      await waitFor(() => expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull());
      expect(screen.getByText('Stage tag up to date')).toBeInTheDocument();
      expect(retries).toBe(1);
    });

    it('a retry that fails says "The retry did not work." and the state stays failed', async () => {
      server.use(
        http.post('*/api/quote-requests/:id/ghl-copy-retries', () =>
          HttpResponse.json({ copy: { state: 'failed', at: '2026-11-19T21:00:00Z' }, retried: true }),
        ),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = await open(PRIYA);
      fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
      expect(await screen.findByText('The retry did not work.')).toBeInTheDocument();
      expect(screen.getByText(/Copy to GoHighLevel failed/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry copy' })).not.toHaveAttribute('aria-disabled');
      await expectNoAxeViolations(container);
    });

    it('a retry the server refuses (409 not_retryable) says it could not run', async () => {
      server.use(http.post('*/api/quote-requests/:id/ghl-copy-retries', () => problem(409, 'not_retryable', 'Not retryable')), ...buildStaffHandlers('signed-in'));
      await open(PRIYA);
      fireEvent.click(screen.getByRole('button', { name: 'Retry copy' }));
      expect(await screen.findByText('The retry could not run.')).toBeInTheDocument();
    });
  });

  describe('Your quote', () => {
    it('Empty: both fields blank, a line saying either can be saved alone, the limits as hints', async () => {
      useMock();
      await open();
      expect(price()).toHaveValue('');
      expect(note()).toHaveValue('');
      expect(screen.getByText('No price or note yet. Both are optional, and you can save either one alone.')).toBeInTheDocument();
      expect(screen.getByText('From 0.01 to 99,999.99. No tax is added and no payment is taken.')).toBeInTheDocument();
      expect(screen.getByText('Up to 1,000 characters.')).toBeInTheDocument();
      expect(price()).toHaveAccessibleDescription('From 0.01 to 99,999.99. No tax is added and no payment is taken.');
    });

    it('Success: sends cents and the version she saw; "Saved." names what was stored; the price shows large; last updated appears; the status does NOT change', async () => {
      useMock();
      const { container } = await open();
      fireEvent.change(price(), { target: { value: '450.00' } });
      fireEvent.change(note(), { target: { value: 'Replace cartridge, 2 hours, can come Thursday' } });
      expect(screen.getByText('45 of 1,000 characters.')).toBeInTheDocument();
      save();
      const banner = await screen.findByText('Saved.');
      expect(banner.closest('[role="status"]')).toHaveTextContent('Price $450.00 CAD and your note are stored on NQ-7K3M9P.');
      expect(saves).toEqual([{ price_cents: 45000, note: 'Replace cartridge, 2 hours, can come Thursday', version: 1 }]);
      expect(screen.getByText('$450.00')).toBeInTheDocument();
      expect(screen.getByText('CAD, quoted')).toBeInTheDocument();
      expect(await screen.findByText(/Last updated by Owner (at|on) /)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true'); // saving a price never changes the status
      expect(changes).toHaveLength(0);
      expect(price()).toHaveValue('450.00');
      await expectNoAxeViolations(container);
    });

    it('accepts how she types money: "$1,250" is 125,000 cents; the next save carries the version the server answered', async () => {
      useMock();
      await open();
      fireEvent.change(price(), { target: { value: '$1,250' } });
      save();
      await screen.findByText('Saved.');
      fireEvent.change(note(), { target: { value: 'second' } });
      save();
      await waitFor(() => expect(saves).toHaveLength(2));
      expect(saves.map((body) => [body.price_cents, body.version])).toEqual([
        [125000, 1],
        [125000, 2],
      ]);
    });

    it('a note can be saved without a price, and a price without a note', async () => {
      useMock();
      await open();
      fireEvent.change(note(), { target: { value: 'Call before coming' } });
      save();
      expect(await screen.findByText('Your note is stored on NQ-7K3M9P.')).toBeInTheDocument();
      fireEvent.change(note(), { target: { value: '' } });
      fireEvent.change(price(), { target: { value: '80' } });
      save();
      await waitFor(() => expect(screen.getByText('Price $80.00 CAD is stored on NQ-7K3M9P.')).toBeInTheDocument());
      expect(saves).toEqual([
        { price_cents: null, note: 'Call before coming', version: 1 },
        { price_cents: 8000, note: null, version: 2 },
      ]);
    });

    it('clearing the price sends null and replaces it; the old price is shown nowhere', async () => {
      useMock();
      await open(PRIYA);
      expect(price()).toHaveValue('320.00');
      fireEvent.change(price(), { target: { value: '' } });
      save();
      await screen.findByText('Saved.');
      expect(saves.at(-1)).toMatchObject({ price_cents: null });
      expect(screen.queryByText('$320.00')).toBeNull();
    });

    it('Error (refused before sending): a summary that links to each field, messages under the fields, everything typed kept, no request', async () => {
      useMock();
      const { container } = await open();
      fireEvent.change(price(), { target: { value: '100000.00' } });
      fireEvent.change(note(), { target: { value: 'x'.repeat(1001) } });
      save();
      const summary = await screen.findByRole('alert', { name: 'Nothing was saved. Fix these 2 things:' });
      expect(within(summary).getByRole('link', { name: /Price: enter an amount from 0.01 to 99,999.99 with at most 2 decimals/ })).toHaveAttribute('href', '#price');
      expect(within(summary).getByRole('link', { name: 'Note: use 1,000 characters or fewer' })).toHaveAttribute('href', '#note');
      await waitFor(() => expect(document.activeElement).toBe(summary));
      expect(price()).toHaveAttribute('aria-invalid', 'true');
      expect(price()).toHaveAccessibleDescription('Enter an amount from 0.01 to 99,999.99 with at most 2 decimals');
      expect(note()).toHaveAccessibleDescription('Notes can be up to 1,000 characters. This one is 1,001.');
      expect(price()).toHaveValue('100000.00');
      expect((note() as HTMLTextAreaElement).value).toHaveLength(1001);
      expect(saves).toHaveLength(0);
      await expectNoAxeViolations(container);

      fireEvent.change(price(), { target: { value: '12.345' } });
      fireEvent.change(note(), { target: { value: 'fine' } });
      save();
      expect(await screen.findByRole('alert', { name: 'Nothing was saved. Fix this 1 thing:' })).toBeInTheDocument();
      expect(screen.queryByText(/Notes can be up to/)).toBeNull();

      fireEvent.change(price(), { target: { value: '12.34' } });
      save();
      await screen.findByText('Saved.');
      expect(screen.queryByRole('alert', { name: /Nothing was saved/ })).toBeNull();
      expect(saves).toEqual([{ price_cents: 1234, note: 'fine', version: 1 }]);
    });

    it('Error (network drop): "Couldn\'t save. Try again.", the values kept, the button reads "Try saving again"', async () => {
      let calls = 0;
      server.use(
        http.put('*/api/quote-requests/:id/quote', () => {
          calls += 1;
          return calls === 1 ? HttpResponse.error() : undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = await open();
      fireEvent.change(price(), { target: { value: '450.00' } });
      fireEvent.change(note(), { target: { value: 'Thursday' } });
      save();
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent("Couldn't save. Try again.");
      expect(banner).toHaveTextContent('Your price and note are still here. Nothing was changed on the request.');
      expect(price()).toHaveValue('450.00');
      expect(note()).toHaveValue('Thursday');
      expect(screen.getByRole('button', { name: 'Try saving again' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
      save();
      expect(await screen.findByText('Saved.')).toBeInTheDocument();
      expect(screen.queryByText("Couldn't save. Try again.")).toBeNull();
    });

    it('a server refusal (422) lands next to the field it names', async () => {
      server.use(
        http.put('*/api/quote-requests/:id/quote', () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Some answers need fixing', status: 422, code: 'validation_failed', errors: [{ field: 'price_cents', message: 'Too high' }] },
            { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
          ),
        ),
        ...buildStaffHandlers('signed-in'),
      );
      await open();
      fireEvent.change(price(), { target: { value: '450' } });
      save();
      expect(await screen.findByRole('alert', { name: 'Nothing was saved. Fix this 1 thing:' })).toBeInTheDocument();
      expect(price()).toHaveAttribute('aria-invalid', 'true');
      expect(price()).toHaveValue('450');
    });

    it('Loading: while it saves the button reads "Saving" and is paused, so a double press makes one save', async () => {
      let release: () => void = () => undefined;
      server.use(
        http.put('*/api/quote-requests/:id/quote', async ({ request }) => {
          saves.push((await request.clone().json()) as (typeof saves)[number]);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      await open();
      fireEvent.change(price(), { target: { value: '450' } });
      save();
      const busy = await screen.findByRole('button', { name: 'Saving' });
      expect(busy).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(busy);
      fireEvent.submit(busy.closest('form') as HTMLFormElement);
      release();
      await screen.findByText('Saved.');
      expect(saves).toHaveLength(1);
    });

    it('someone else saved first (409): the designed message and Reload; her note is kept below to copy; Reload shows the latest', async () => {
      useMock('stale');
      const { container } = await open();
      fireEvent.change(note(), { target: { value: 'Replace cartridge, 2 hours' } });
      save();
      expect(await screen.findByText('This request was changed by someone else. Reload to see the latest.')).toBeInTheDocument();
      expect(screen.getByText(/Their price is still the saved one/)).toBeInTheDocument();
      const kept = screen.getByLabelText('Your note, not saved');
      expect(kept).toHaveValue('Replace cartridge, 2 hours');
      expect(screen.queryByRole('button', { name: 'Save price and note' })).toBeNull(); // nothing is overwritten
      await expectNoAxeViolations(container);

      server.resetHandlers();
      useMock('signed-in');
      fireEvent.click(screen.getByRole('button', { name: 'Reload this request' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save price and note' })).toBeInTheDocument());
      expect(screen.queryByText('This request was changed by someone else. Reload to see the latest.')).toBeNull();
    });

    it('a session that ended while saving: nothing is saved and she is sent to SCR-03 (AC-004.7)', async () => {
      server.use(http.put('*/api/quote-requests/:id/quote', () => problem(401, 'session_expired', 'Your session ended.')), ...buildStaffHandlers('signed-in'));
      await open();
      fireEvent.change(note(), { target: { value: 'typed' } });
      save();
      await waitFor(() => expect(go.navigateTo).toHaveBeenCalledWith('/sign-in?next=/requests&session=ended')); // /requests/mock-1 is not on the allow-list, so she lands on Requests
      expect(screen.queryByText("Couldn't save. Try again.")).toBeNull();
    });
  });

  describe('Status', () => {
    it('shows the four statuses with the current one pressed, and says saving a price does not change it', async () => {
      useMock();
      const { container } = await open();
      const group = screen.getByRole('group', { name: 'Status' });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['New', 'Quoted', 'Won', 'Lost']);
      expect(within(group).getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText(/Saving a price does not change the status/)).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });

    it('choosing a status saves at once with the version she saw, and the badge and control show it', async () => {
      useMock();
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'Quoted' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Quoted' })).toHaveAttribute('aria-pressed', 'true'));
      expect(changes).toEqual([{ to_status: 'quoted', version: 1 }]);
      await waitFor(() => expect(screen.getAllByText('Quoted').length).toBeGreaterThan(1)); // the header badge too
      expect(await screen.findByText(/Last updated by Owner (at|on) /)).toBeInTheDocument();
      // GoHighLevel: the stage tag is being updated
      expect(await screen.findByText('Stage tag waiting to retry')).toBeInTheDocument();
    });

    it('the status control is paused while a change saves, the chosen status is marked busy, and others cannot be chosen', async () => {
      let release: () => void = () => undefined;
      server.use(
        http.post('*/api/quote-requests/:id/status-changes', async ({ request }) => {
          changes.push((await request.clone().json()) as (typeof changes)[number]);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'Won' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lost' })).toHaveAttribute('aria-disabled', 'true'));
      expect(screen.getByRole('button', { name: 'Won' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Lost' }));
      release();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lost' })).not.toHaveAttribute('aria-disabled'));
      expect(changes).toHaveLength(1);
    });

    it('choosing the status it already has does nothing and says nothing', async () => {
      useMock();
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(changes).toHaveLength(0);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('Won can go to Lost', async () => {
      useMock();
      await open('a0000000-0000-4000-8000-000000000005'); // Aisha, Won
      expect(screen.getByRole('button', { name: 'Won' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Lost' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lost' })).toHaveAttribute('aria-pressed', 'true'));
      expect(changes).toEqual([{ to_status: 'lost', version: 1 }]);
    });

    it('a failed status save keeps the previous status with "Couldn\'t save. Try again."', async () => {
      useMock('save-failed');
      const { container } = await open();
      fireEvent.click(screen.getByRole('button', { name: 'Won' }));
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent("Couldn't save. Try again.");
      expect(banner).toHaveTextContent('The status is still New. Nothing was changed.');
      expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
      await expectNoAxeViolations(container);
    });

    it('someone else changed it first (409): the changed-by-someone-else notice, and the price and note are not overwritten', async () => {
      useMock('stale');
      await open();
      fireEvent.change(note(), { target: { value: 'my words' } });
      fireEvent.click(screen.getByRole('button', { name: 'Won' }));
      expect(await screen.findByText('This request was changed by someone else. Reload to see the latest.')).toBeInTheDocument();
      expect(screen.getByLabelText('Your note, not saved')).toHaveValue('my words');
    });
  });
});
