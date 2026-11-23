// @vitest-environment jsdom
// SCR-04: the Requests tab in every designed state, the status change from a row, the filter and the search (client
// state), "Show more", and what survives a visit to a request. The API is the mock API through msw, with overrides.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestsList } from '@/components/staff/requests-list';
import { expectNoAxeViolations, renderStaff } from '@/components/staff/test-support';
import type { Problem, ProblemCode, QuoteRequestSummary } from '@/lib/api/generated/model';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

vi.mock('next/navigation', () => ({ usePathname: () => '/requests', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
const go = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/components/staff/navigation', () => go);

const server = setupServer();
const listCalls: URLSearchParams[] = [];
const statusCalls: Array<{ id: string; body: { to_status: string; version: number } }> = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  listCalls.length = 0;
  statusCalls.length = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

function useMock(scenario: Parameters<typeof buildStaffHandlers>[0] = 'signed-in') {
  server.use(
    http.get('*/api/quote-requests', ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return undefined;
    }),
    http.post('*/api/quote-requests/:id/status-changes', async ({ request, params }) => {
      statusCalls.push({ id: String(params.id), body: (await request.clone().json()) as { to_status: string; version: number } });
      return undefined;
    }),
    ...buildStaffHandlers(scenario),
  );
}

function problem(status: number, code: ProblemCode, title: string) {
  const body: Problem = { type: 'about:blank', title, status, code };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

const names = () => screen.getAllByRole('listitem').flatMap((item) => within(item).queryAllByRole('link', { name: /^[A-Z][a-z]+ [A-Z]/ }).map((link) => link.textContent));
const row = (reference: string) => screen.getByRole('link', { name: reference }).closest('li') as HTMLElement;

describe('SCR-04 Requests tab', () => {
  it('Success: newest first, the six facts per row, the reference and the name both link to the request', async () => {
    useMock();
    const { container } = renderStaff(<RequestsList />);
    expect(await screen.findByRole('link', { name: 'NQ-7K3M9P' })).toHaveAttribute('href', '/requests/a0000000-0000-4000-8000-000000000001');
    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeInTheDocument();
    expect(names()).toEqual(['Dana Whitfield', 'Marcus Oyelaran', 'Priya Raman', 'Tomasz Kowalski', 'Aisha Rahman', 'Luc Bergeron', 'Greg Hallett', 'Hannah Frey']);

    const dana = row('NQ-7K3M9P');
    expect(within(dana).getByRole('link', { name: 'Dana Whitfield' })).toHaveAttribute('href', '/requests/a0000000-0000-4000-8000-000000000001');
    expect(within(dana).getByText('New')).toBeInTheDocument();
    expect(within(dana).getByText('Soon')).toBeInTheDocument();
    expect(within(dana).getByText('Nov 19, 9:10 a.m.')).toBeInTheDocument();
    expect(within(dana).getByRole('button', { name: 'Move to another status, NQ-7K3M9P' })).toBeInTheDocument();
    expect(within(row('NQ-4HX2RB')).getByText('Emergency')).toBeInTheDocument();
    expect(within(row('NQ-6GM2YE')).getByText('Won')).toBeInTheDocument();
    expect(within(row('NQ-8VD5SK')).getByText('Lost')).toBeInTheDocument();
    expect(await screen.findByText('Requests this week')).toBeInTheDocument(); // the weekly strip is on this tab
    expect(listCalls[0]?.get('limit')).toBe('50');
    expect(screen.queryByRole('switch')).toBeNull(); // no List / Board switch
    await expectNoAxeViolations(container);
  });

  it('Loading: skeleton rows in the real layout, the page marked busy, "Loading requests" announced', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.get('*/api/quote-requests', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ data: [], next_cursor: null });
      }),
      ...buildStaffHandlers('signed-in'),
    );
    const { container } = renderStaff(<RequestsList />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Loading requests')).toBeInTheDocument();
    expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(4);
    await expectNoAxeViolations(container);
    release();
    expect(await screen.findByText('No quote requests yet')).toBeInTheDocument();
  });

  it('Empty (first use): what will show up here and a link to the Request a quote page; the count shows 0, 0, 0', async () => {
    useMock('empty');
    const { container } = renderStaff(<RequestsList />);
    expect(await screen.findByRole('heading', { name: 'No quote requests yet' })).toBeInTheDocument();
    expect(screen.getByText(/Requests from the Request a quote page show up here/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open the Request a quote page/ });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    await waitFor(() => expect(screen.getAllByText('0')).toHaveLength(3));
    await expectNoAxeViolations(container);
  });

  it('Error: "Couldn\'t load requests. Try again." and the list is NOT shown; Try again loads it', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/quote-requests', () => {
        calls += 1;
        return calls === 1 ? problem(500, 'internal_error', 'Something went wrong') : undefined;
      }),
      ...buildStaffHandlers('signed-in'),
    );
    const { container } = renderStaff(<RequestsList />);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent("Couldn't load requests. Try again.");
    expect(screen.queryByRole('link', { name: 'NQ-7K3M9P' })).toBeNull();
    expect(screen.queryByText('No quote requests yet')).toBeNull();
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'NQ-7K3M9P' })).toBeInTheDocument();
  });

  it('a list that breaks the contract shows the "can\'t load" state, not a crash', async () => {
    server.use(http.get('*/api/quote-requests', () => HttpResponse.json({ data: [{ id: 'x' }], next_cursor: null })), ...buildStaffHandlers('signed-in'));
    renderStaff(<RequestsList />);
    expect(await screen.findByText("Couldn't load requests. Try again.")).toBeInTheDocument();
  });

  it('the count cannot load: "Count unavailable", and the list still loads (AC-008.8)', async () => {
    server.use(http.get('*/api/weekly-counts/current', () => problem(500, 'internal_error', 'Something went wrong')), ...buildStaffHandlers('signed-in'));
    renderStaff(<RequestsList />);
    expect(await screen.findByText('Count unavailable')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'NQ-7K3M9P' })).toBeInTheDocument();
  });

  describe('filter and search (client state, not the address)', () => {
    it('a status filter asks for that status and marks the active segment', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      const all = screen.getByRole('button', { name: 'All' });
      expect(all).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Quoted' }));
      await waitFor(() => expect(names()).toEqual(['Priya Raman', 'Tomasz Kowalski']));
      expect(screen.getByRole('button', { name: 'Quoted' })).toHaveAttribute('aria-pressed', 'true');
      expect(all).toHaveAttribute('aria-pressed', 'false');
      expect(listCalls.at(-1)?.get('status')).toBe('quoted');
    });

    it('a filter with no matches says so, with a way back to All', async () => {
      server.use(
        http.get('*/api/quote-requests', ({ request }) =>
          new URL(request.url).searchParams.get('status') === 'lost' ? HttpResponse.json({ data: [], next_cursor: null }) : undefined,
        ),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(screen.getByRole('button', { name: 'Lost' }));
      expect(await screen.findByRole('heading', { name: 'No lost requests' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
      fireEvent.click(screen.getByRole('button', { name: 'Show all requests' }));
      expect(await screen.findByRole('link', { name: 'NQ-7K3M9P' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('a search finds a partial name, sends q only when she presses Search, and "No matching requests" has a way back', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      const box = screen.getByRole('textbox', { name: 'Search by reference, name or phone' });
      fireEvent.change(box, { target: { value: 'whit' } });
      expect(listCalls.every((call) => !call.has('q'))).toBe(true); // typing alone asks nothing
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(names()).toEqual(['Dana Whitfield']));
      expect(listCalls.at(-1)?.get('q')).toBe('whit');

      fireEvent.change(box, { target: { value: 'zzz' } });
      fireEvent.submit(box.closest('form') as HTMLFormElement);
      expect(await screen.findByRole('heading', { name: 'No matching requests' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show all requests' }));
      expect(await screen.findByRole('link', { name: 'NQ-7K3M9P' })).toBeInTheDocument();
      expect(box).toHaveValue('');
    });

    it('a search by phone digits finds the request', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.change(screen.getByRole('textbox', { name: 'Search by reference, name or phone' }), { target: { value: '905-555-0178' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(names()).toEqual(['Marcus Oyelaran']));
    });
  });

  describe('Move to', () => {
    it('opens a menu of the OTHER three statuses; arrow keys move, Escape closes and returns focus to the button', async () => {
      useMock();
      const { container } = renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      const button = within(row('NQ-7K3M9P')).getByRole('button', { name: 'Move to another status, NQ-7K3M9P' });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(button);
      const menu = screen.getByRole('menu', { name: 'Move NQ-7K3M9P to' });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual(['Quoted', 'Won', 'Lost']); // not New: it is New already
      await waitFor(() => expect(document.activeElement).toBe(items[0]));
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[1]);
      fireEvent.keyDown(menu, { key: 'End' });
      expect(document.activeElement).toBe(items[2]);
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[0]); // wraps inside the menu
      await expectNoAxeViolations(container);
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(button);
    });

    it('a status change shows the new badge in place, the row KEEPS its position, the count refreshes, and it is announced', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      await screen.findByText('Requests this week');
      const before = names();

      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));

      await waitFor(() => expect(within(row('NQ-7K3M9P')).getByText('Won')).toBeInTheDocument());
      expect(names()).toEqual(before);
      expect(statusCalls).toEqual([{ id: 'a0000000-0000-4000-8000-000000000001', body: { to_status: 'won', version: 1 } }]);
      await waitFor(() => expect(screen.getByText('NQ-7K3M9P moved to Won')).toBeInTheDocument());
      // the strip fetched again: Won went 1 -> 2
      const strip = screen.getByRole('region', { name: 'THIS WEEK' });
      await waitFor(() => expect(within(within(strip).getByText('Won').closest('li') as HTMLElement).getByText('2')).toBeInTheDocument());
    });

    it('a second change uses the new version (the row carries what the server answered)', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Quoted' }));
      await waitFor(() => expect(within(row('NQ-7K3M9P')).getByText('Quoted')).toBeInTheDocument());
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Lost' }));
      await waitFor(() => expect(within(row('NQ-7K3M9P')).getByText('Lost')).toBeInTheDocument());
      expect(statusCalls.map((call) => call.body)).toEqual([
        { to_status: 'quoted', version: 1 },
        { to_status: 'lost', version: 2 },
      ]);
    });

    it('with a filter on, the row leaves the list without a reload', async () => {
      useMock();
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      await waitFor(() => expect(names()).toEqual(['Dana Whitfield', 'Marcus Oyelaran']));
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      await waitFor(() => expect(names()).toEqual(['Marcus Oyelaran']));
    });

    it('while a row saves its Move to is paused (one press, one save) and the others are not', async () => {
      let release: () => void = () => undefined;
      server.use(
        http.post('*/api/quote-requests/:id/status-changes', async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      const button = within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ });
      fireEvent.click(button);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(button);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(within(row('NQ-4HX2RB')).getByRole('button', { name: /Move to another status/ })).not.toHaveAttribute('aria-disabled');
      release();
      await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    });

    it('a failed save: "Couldn\'t save. Try again.", the row keeps its old status, and she can try again', async () => {
      let calls = 0;
      server.use(
        http.post('*/api/quote-requests/:id/status-changes', () => {
          calls += 1;
          return calls === 1 ? problem(500, 'internal_error', 'Something went wrong') : undefined;
        }),
        ...buildStaffHandlers('signed-in'),
      );
      const { container } = renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent("Couldn't save. Try again.");
      expect(banner).toHaveTextContent('NQ-7K3M9P is still New. Nothing was changed.');
      expect(within(row('NQ-7K3M9P')).getByText('New')).toBeInTheDocument();
      await expectNoAxeViolations(container);
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      await waitFor(() => expect(within(row('NQ-7K3M9P')).getByText('Won')).toBeInTheDocument());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('someone else changed it first (409): the designed message with Reload, which asks the list again', async () => {
      useMock('stale');
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      const banner = await screen.findByText('This request was changed by someone else. Reload to see the latest.');
      expect(within(row('NQ-7K3M9P')).getByText('New')).toBeInTheDocument();
      const asked = listCalls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(listCalls.length).toBeGreaterThan(asked));
      await waitFor(() => expect(banner).not.toBeInTheDocument());
    });

    it('a session that ended during a save signs her out and sends her to SCR-03 (AC-004.7)', async () => {
      server.use(http.post('*/api/quote-requests/:id/status-changes', () => problem(401, 'session_expired', 'Your session ended.')), ...buildStaffHandlers('signed-in'));
      renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(within(row('NQ-7K3M9P')).getByRole('button', { name: /Move to another status/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
      await waitFor(() => expect(go.navigateTo).toHaveBeenCalledWith('/sign-in?next=/requests&session=ended'));
      expect(screen.queryByText("Couldn't save. Try again.")).toBeNull();
    });
  });

  describe('50 at a time', () => {
    const many = (count: number): QuoteRequestSummary[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        reference: `NQ-${String(2000 + index).padStart(6, 'X').slice(-6).replace(/[0189]/g, '7')}`,
        name: `Person ${String.fromCharCode(65 + (index % 26))}${index}`,
        urgency: 'soon',
        status: 'new',
        submitted_at: new Date(Date.UTC(2026, 10, 19, 14, 0) - index * 60_000).toISOString(),
        version: 1,
      }));

    it('51 requests: the 50 newest and a "Show more" that adds the last one', async () => {
      const all = many(51);
      server.use(
        http.get('*/api/quote-requests', ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          return cursor ? HttpResponse.json({ data: all.slice(50), next_cursor: null }) : HttpResponse.json({ data: all.slice(0, 50), next_cursor: 'c50' });
        }),
        ...buildStaffHandlers('signed-in'),
      );
      renderStaff(<RequestsList />);
      await screen.findByText('Person A0');
      expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(50);
      expect(screen.queryByText('Person Z51')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(await screen.findByText('Person Y50')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());
      expect(screen.getAllByRole('link', { name: /^Person / })).toHaveLength(51);
    });
  });

  describe('Back to Requests', () => {
    it('keeps the filter, the search and the scroll position while she opens a request and comes back', async () => {
      useMock();
      const scrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      const view = renderStaff(<RequestsList />);
      await screen.findByRole('link', { name: 'NQ-7K3M9P' });
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      await waitFor(() => expect(names()).toEqual(['Dana Whitfield', 'Marcus Oyelaran']));
      fireEvent.change(screen.getByRole('textbox', { name: 'Search by reference, name or phone' }), { target: { value: 'Marcus' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(names()).toEqual(['Marcus Oyelaran']));

      Object.defineProperty(window, 'scrollY', { value: 420, configurable: true });
      const stay = (event: Event) => event.preventDefault(); // jsdom cannot follow a link; the layout would swap the page
      document.addEventListener('click', stay);
      fireEvent.click(screen.getByRole('link', { name: 'Marcus Oyelaran' })); // opening the request remembers where she was
      document.removeEventListener('click', stay);
      view.rerender(<p>the request</p>); // the layout (and its providers) stay mounted while the page changes
      expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
      view.rerender(<RequestsList />);

      expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('textbox', { name: 'Search by reference, name or phone' })).toHaveValue('Marcus');
      await screen.findByRole('link', { name: 'NQ-4HX2RB' });
      expect(names()).toEqual(['Marcus Oyelaran']);
      await waitFor(() => expect(scrolled).toHaveBeenCalledWith(0, 420));
      scrolled.mockRestore();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    });
  });
});
