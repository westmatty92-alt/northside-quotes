// @vitest-environment jsdom
// SCR-05: the Pipeline tab in every designed state, the three ways to move a card (menu, drag, Escape), the Saving
// state, the revert on a failed save and on a 409, the live-region message, the weekly strip fetching again, "Show more"
// per column. The API is the mock API through msw (src/mocks/staff-handlers.ts), with overrides.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelinePreviewContext } from '@/components/staff/pipeline/pipeline-preview';
import { PipelineBoard } from '@/components/staff/pipeline/pipeline-board';
import { expectNoAxeViolations, renderStaff } from '@/components/staff/test-support';
import type { Problem, ProblemCode } from '@/lib/api/generated/model';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

vi.mock('next/navigation', () => ({ usePathname: () => '/pipeline', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
const go = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/components/staff/navigation', () => go);

const server = setupServer();
const listCalls: URLSearchParams[] = [];
const weekCalls: number[] = [];
const statusCalls: Array<{ id: string; body: { to_status: string; version: number } }> = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  listCalls.length = 0;
  weekCalls.length = 0;
  statusCalls.length = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

/**
 * Records the calls, then lets the mock API answer. `hold()` makes the next status changes wait for `release()`, so the
 * Saving state can be looked at. Anything a test puts in front of the mock API with `server.use` after this wins.
 */
function useMock(scenario: Parameters<typeof buildStaffHandlers>[0] = 'signed-in') {
  const gate = {
    held: false,
    release: () => {},
    hold() {
      gate.held = true;
    },
  };
  server.use(
    http.get('*/api/quote-requests', ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return undefined;
    }),
    http.get('*/api/weekly-counts/current', () => {
      weekCalls.push(Date.now());
      return undefined;
    }),
    http.post('*/api/quote-requests/:id/status-changes', async ({ request, params }) => {
      statusCalls.push({ id: String(params.id), body: (await request.clone().json()) as { to_status: string; version: number } });
      if (gate.held) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return undefined;
    }),
    ...buildStaffHandlers(scenario),
  );
  return gate;
}

function problem(status: number, code: ProblemCode, title: string) {
  const body: Problem = { type: 'about:blank', title, status, code };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

const column = (name: string) => screen.getByRole('region', { name });
const refs = (name: string) => within(column(name)).queryAllByRole('link').map((link) => link.textContent);
const card = (reference: string) => screen.getByRole('link', { name: reference }).closest('li') as HTMLElement;
const moveButton = (reference: string) => within(card(reference)).getByRole('button', { name: /^Move to another status/ });
const DANA = 'a0000000-0000-4000-8000-000000000001';
/** The card's own element, found even when it is hidden from assistive technology (the gap left by a drag). */
const cardById = (id: string) => document.querySelector(`[data-card="${id}"]`);

async function loaded() {
  await screen.findByRole('link', { name: 'NQ-7K3M9P' });
  await screen.findByText('Requests this week');
}

function chooseFromMenu(reference: string, status: string) {
  fireEvent.click(moveButton(reference));
  fireEvent.click(screen.getByRole('menuitem', { name: status }));
}

/** A column's place on screen, so a drop can be aimed at it (jsdom has no layout). */
function placeColumn(name: string, left: number) {
  column(name).getBoundingClientRect = () => ({ left, right: left + 200, top: 100, bottom: 700, width: 200, height: 600, x: left, y: 100, toJSON: () => ({}) });
}
function placeColumns() {
  placeColumn('New', 0);
  placeColumn('Quoted', 220);
  placeColumn('Won', 440);
  placeColumn('Lost', 660);
}
const mouse = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 } as const;
const pick = (reference: string) => fireEvent.pointerDown(within(card(reference)).getByText(/^[A-Z][a-z]+ [A-Z]/), { ...mouse, clientX: 50, clientY: 150 });
const dragTo = (x: number, y = 300) => fireEvent.pointerMove(window, { ...mouse, clientX: x, clientY: y });
const letGo = (x: number, y = 300) => fireEvent.pointerUp(window, { ...mouse, clientX: x, clientY: y });

describe('SCR-05 Pipeline tab', () => {
  it('Success: four fixed columns New, Quoted, Won, Lost, one call each by status and never q, every card links to its request', async () => {
    useMock();
    const { container } = renderStaff(<PipelineBoard />);
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['THIS WEEK', 'New', 'Quoted', 'Won', 'Lost']);
    expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
    expect(refs('Quoted')).toEqual(['NQ-9TQ6WD', 'NQ-3FZ8NC']);
    expect(refs('Won')).toEqual(['NQ-6GM2YE', 'NQ-2CJ7XT']);
    expect(refs('Lost')).toEqual(['NQ-8VD5SK', 'NQ-5RW4HN']);
    expect(screen.getByRole('link', { name: 'NQ-7K3M9P' })).toHaveAttribute('href', '/pipeline/a0000000-0000-4000-8000-000000000001');

    const dana = card('NQ-7K3M9P');
    expect(within(dana).getByText('Dana Whitfield')).toBeInTheDocument();
    expect(within(dana).getByText('Soon')).toBeInTheDocument();
    expect(within(dana).getByText('Nov 19, 9:10 a.m.')).toBeInTheDocument();
    expect(within(card('NQ-4HX2RB')).getByText('Emergency')).toBeInTheDocument();
    expect(moveButton('NQ-7K3M9P')).toBeVisible();

    expect(listCalls.map((call) => call.get('status')).sort()).toEqual(['lost', 'new', 'quoted', 'won']);
    expect(listCalls.every((call) => !call.has('q') && call.get('limit') === '50')).toBe(true);
    expect(await screen.findByText('Requests this week')).toBeInTheDocument(); // the weekly strip, SCR-07
    expect(screen.getByText(/To filter or search, use the Requests tab\./)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull(); // no List / Board switch
    expect(screen.queryByRole('button', { name: /add|rename|delete|remove|reorder/i })).toBeNull(); // nothing changes a column
    await expectNoAxeViolations(container);
  });

  it('on a phone there is a "Jump to a column" row with a link to each column', async () => {
    useMock();
    renderStaff(<PipelineBoard />);
    await loaded();
    const jump = screen.getByRole('navigation', { name: 'Jump to a column' });
    expect(within(jump).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['New', '#col-new'],
      ['Quoted', '#col-quoted'],
      ['Won', '#col-won'],
      ['Lost', '#col-lost'],
    ]);
    expect(column('Lost')).toHaveAttribute('id', 'col-lost');
  });

  it('Loading: four skeleton columns in the real layout, the page busy, "Loading the board" announced, no controls yet', async () => {
    const waiting: Array<() => void> = []; // one call per column, all held
    const release = () => waiting.forEach((resolve) => resolve());
    server.use(
      http.get('*/api/quote-requests', async () => {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
        return undefined;
      }),
      ...buildStaffHandlers('signed-in'),
    );
    const { container } = renderStaff(<PipelineBoard />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Loading the board')).toBeInTheDocument();
    expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByRole('button', { name: /Move to/ })).toBeNull();
    await expectNoAxeViolations(container);
    release();
    await loaded();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('Empty: four empty columns each with its own message, the count 0, 0, 0, and no cards', async () => {
    useMock('empty');
    const { container } = renderStaff(<PipelineBoard />);
    expect(await screen.findByText('No new requests')).toBeInTheDocument();
    expect(screen.getByText('No quoted requests')).toBeInTheDocument();
    expect(screen.getByText('No won requests')).toBeInTheDocument();
    expect(screen.getByText('No lost requests')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to/ })).toBeNull();
    await waitFor(() => expect(screen.getAllByText('0')).toHaveLength(3));
    await expectNoAxeViolations(container);
  });

  it('an empty column is still a valid place to move a card to (AC-016.11)', async () => {
    useMock();
    renderStaff(<PipelineBoard />);
    await loaded();
    chooseFromMenu('NQ-8VD5SK', 'New');
    chooseFromMenu('NQ-5RW4HN', 'New');
    await waitFor(() => expect(screen.getByText('No lost requests')).toBeInTheDocument());
    chooseFromMenu('NQ-7K3M9P', 'Lost');
    await waitFor(() => expect(refs('Lost')).toEqual(['NQ-7K3M9P']));
    expect(statusCalls.map((call) => call.body.to_status)).toEqual(['new', 'new', 'lost']);
  });

  it('Error: "Couldn\'t load requests. Try again." and NO columns when any column cannot load; Try again loads them', async () => {
    let failing = true;
    server.use(
      http.get('*/api/quote-requests', ({ request }) => {
        if (failing && new URL(request.url).searchParams.get('status') === 'quoted') return problem(500, 'internal_error', 'Something went wrong');
        return undefined;
      }),
      ...buildStaffHandlers('signed-in'),
    );
    const { container } = renderStaff(<PipelineBoard />);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent("Couldn't load requests. Try again.");
    expect(screen.queryByRole('region', { name: 'New' })).toBeNull();
    expect(screen.queryByText('No new requests')).toBeNull();
    expect(screen.queryByRole('link', { name: 'NQ-7K3M9P' })).toBeNull();
    expect(await screen.findByText('Requests this week')).toBeInTheDocument(); // the strip loads on its own
    await expectNoAxeViolations(container);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    expect(refs('Quoted')).toEqual(['NQ-9TQ6WD', 'NQ-3FZ8NC']);
  });

  it('a list that breaks the contract shows the "can\'t load" state, not a crash', async () => {
    server.use(http.get('*/api/quote-requests', () => HttpResponse.json({ data: [{ id: 'x' }], next_cursor: null })), ...buildStaffHandlers('signed-in'));
    renderStaff(<PipelineBoard />);
    expect(await screen.findByText("Couldn't load requests. Try again.")).toBeInTheDocument();
  });

  it('51 cards in one column: that column shows its 50 newest and "Show more" adds the last 1; the others have no "Show more" (AC-016.10)', async () => {
    const alphabet = '23456789';
    const rows = Array.from({ length: 51 }, (_, n) => ({
      id: `b0000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
      reference: `NQ-2222${alphabet[n >> 3]}${alphabet[n & 7]}`,
      name: `Homeowner ${n + 1}`,
      urgency: 'flexible',
      status: 'quoted',
      submitted_at: new Date(Date.UTC(2026, 10, 19, 20, 0) - n * 60_000).toISOString(),
      version: 1,
    }));
    server.use(
      http.get('*/api/quote-requests', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('status') !== 'quoted') return undefined;
        const first = !url.searchParams.get('cursor');
        return HttpResponse.json(first ? { data: rows.slice(0, 50), next_cursor: 'o50' } : { data: rows.slice(50), next_cursor: null });
      }),
      ...buildStaffHandlers('signed-in'),
    );
    renderStaff(<PipelineBoard />);
    await screen.findByRole('link', { name: 'NQ-7K3M9P' });
    await waitFor(() => expect(within(column('Quoted')).getAllByRole('button', { name: /^Move to another status/ })).toHaveLength(50));
    expect(within(column('Quoted')).getAllByRole('button', { name: 'Show more' })).toHaveLength(1);
    for (const other of ['New', 'Won', 'Lost']) expect(within(column(other)).queryByRole('button', { name: 'Show more' })).toBeNull();
    fireEvent.click(within(column('Quoted')).getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(column('Quoted')).getAllByRole('button', { name: /^Move to another status/ })).toHaveLength(51));
    expect(within(column('Quoted')).queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  describe('Move to (the keyboard and touch path)', () => {
    it('opens with the arrow key, arrows choose, Enter moves; the card sits in the new column marked Saving, then it is saved', async () => {
      const gate = useMock();
      gate.hold();
      const { container } = renderStaff(<PipelineBoard />);
      await loaded();
      const weekBefore = weekCalls.length;
      moveButton('NQ-7K3M9P').focus();
      fireEvent.keyDown(moveButton('NQ-7K3M9P'), { key: 'ArrowDown' });
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Quoted' })).toHaveFocus());
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Quoted', 'Won', 'Lost']); // the other three
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
      expect(screen.getByRole('menuitem', { name: 'Won' })).toHaveFocus();
      fireEvent.click(document.activeElement as HTMLElement); // Enter on a button is a click

      // already in Won, marked Saving, its Move to paused, the weekly count not yet asked for again
      await waitFor(() => expect(refs('Won')).toContain('NQ-7K3M9P'));
      expect(refs('New')).toEqual(['NQ-4HX2RB']);
      expect(within(card('NQ-7K3M9P')).getByText('Saving')).toBeInTheDocument();
      expect(moveButton('NQ-7K3M9P')).toHaveAttribute('aria-disabled', 'true');
      expect(moveButton('NQ-7K3M9P')).toHaveFocus(); // focus stays with the card
      expect(statusCalls).toEqual([{ id: DANA, body: { to_status: 'won', version: 1 } }]);
      fireEvent.click(moveButton('NQ-7K3M9P'));
      expect(screen.queryByRole('menu')).toBeNull(); // paused: one press, one save
      expect(statusCalls).toHaveLength(1);
      expect(weekCalls).toHaveLength(weekBefore);
      await expectNoAxeViolations(container);

      gate.release();
      await waitFor(() => expect(within(card('NQ-7K3M9P')).queryByText('Saving')).toBeNull());
      expect(refs('Won')).toEqual(['NQ-7K3M9P', 'NQ-6GM2YE', 'NQ-2CJ7XT']);
      expect(screen.getByText('NQ-7K3M9P moved to Won')).toBeInTheDocument();
      expect(screen.getByText('NQ-7K3M9P moved to Won').closest('[role="status"]')).not.toBeNull(); // read out politely
      await waitFor(() => expect(weekCalls.length).toBeGreaterThan(weekBefore)); // the strip fetches again
      expect(moveButton('NQ-7K3M9P')).not.toHaveAttribute('aria-disabled');
      expect(moveButton('NQ-7K3M9P')).toHaveFocus();
    });

    it('a moved card takes its submitted-time position in the column, never the top (AC-016.8)', async () => {
      const gate = useMock();
      gate.hold();
      renderStaff(<PipelineBoard />);
      await loaded();
      chooseFromMenu('NQ-8VD5SK', 'Won'); // Nov 12, between Nov 13 and Nov 10
      await waitFor(() => expect(refs('Won')).toEqual(['NQ-6GM2YE', 'NQ-8VD5SK', 'NQ-2CJ7XT']));
      gate.release();
      await waitFor(() => expect(within(card('NQ-8VD5SK')).queryByText('Saving')).toBeNull());
      expect(refs('Won')).toEqual(['NQ-6GM2YE', 'NQ-8VD5SK', 'NQ-2CJ7XT']);
      expect(refs('Lost')).toEqual(['NQ-5RW4HN']);
    });

    it('the next move of the same card carries the new version', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      chooseFromMenu('NQ-7K3M9P', 'Quoted');
      await waitFor(() => expect(within(card('NQ-7K3M9P')).queryByText('Saving')).toBeNull());
      await waitFor(() => expect(moveButton('NQ-7K3M9P')).not.toHaveAttribute('aria-disabled'));
      chooseFromMenu('NQ-7K3M9P', 'Lost');
      await waitFor(() => expect(statusCalls).toHaveLength(2));
      expect(statusCalls.map((call) => call.body)).toEqual([
        { to_status: 'quoted', version: 1 },
        { to_status: 'lost', version: 2 },
      ]);
      await waitFor(() => expect(refs('Lost')).toContain('NQ-7K3M9P'));
    });

    it('Escape closes the menu and puts focus back on the button; nothing is saved', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      fireEvent.click(moveButton('NQ-7K3M9P'));
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(moveButton('NQ-7K3M9P')).toHaveFocus();
      expect(statusCalls).toHaveLength(0);
    });
  });

  describe('a save that does not work: the card goes back, nothing is stored', () => {
    it('a failed save (AC-016.13): the card returns to its column and position, "Couldn\'t save. Try again.", focus on its Move to, the weekly count unchanged', async () => {
      useMock();
      server.use(http.post('*/api/quote-requests/:id/status-changes', () => problem(500, 'internal_error', 'Something went wrong')));
      const { container } = renderStaff(<PipelineBoard />);
      await loaded();
      const weekBefore = weekCalls.length;
      const listsBefore = listCalls.length;
      chooseFromMenu('NQ-7K3M9P', 'Won');
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent("Couldn't save. Try again.");
      expect(banner).toHaveTextContent('NQ-7K3M9P is still in New. Nothing was changed and the weekly count is the same.');
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']); // its own place, first by time
      expect(refs('Won')).toEqual(['NQ-6GM2YE', 'NQ-2CJ7XT']);
      expect(within(card('NQ-7K3M9P')).queryByText('Saving')).toBeNull();
      expect(moveButton('NQ-7K3M9P')).toHaveFocus();
      expect(moveButton('NQ-7K3M9P')).not.toHaveAttribute('aria-disabled');
      expect(weekCalls).toHaveLength(weekBefore);
      expect(listCalls).toHaveLength(listsBefore); // nothing was refetched, nothing stored
      await expectNoAxeViolations(container);

      // and she can try again: the message goes as soon as she does
      server.resetHandlers();
      useMock();
      chooseFromMenu('NQ-7K3M9P', 'Won');
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      await waitFor(() => expect(refs('Won')).toContain('NQ-7K3M9P'));
    });

    it('someone else changed it first (409, AC-016.12): the card goes back, the designed message with Reload, which fetches the board again', async () => {
      useMock('stale');
      const { container } = renderStaff(<PipelineBoard />);
      await loaded();
      chooseFromMenu('NQ-7K3M9P', 'Lost');
      const banner = await screen.findByText('This request was changed by someone else. Reload to see the latest.');
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
      expect(refs('Lost')).toEqual(['NQ-8VD5SK', 'NQ-5RW4HN']);
      expect(screen.getByText('NQ-7K3M9P stays as the other person left it. Your move was not saved.')).toBeInTheDocument();
      await expectNoAxeViolations(container);
      const asked = listCalls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(asked + 4));
      await waitFor(() => expect(banner).not.toBeInTheDocument());
    });

    it('a session that ended (AC-016.14): the card goes back, nothing is saved and she is sent to SCR-03', async () => {
      useMock();
      server.use(http.post('*/api/quote-requests/:id/status-changes', () => problem(401, 'session_expired', 'Your session ended.')));
      renderStaff(<PipelineBoard />);
      await loaded();
      chooseFromMenu('NQ-7K3M9P', 'Won');
      await waitFor(() => expect(go.navigateTo).toHaveBeenCalledWith('/sign-in?next=/pipeline&session=ended'));
      expect(screen.queryByText("Couldn't save. Try again.")).toBeNull(); // no message on this screen
    });
  });

  describe('drag (mouse; a finger by the grip)', () => {
    it('dragging shows the card under the pointer ("Dragging"), a gap where it came from and the target column dashed with "Release to move to Won"', async () => {
      useMock();
      const { container } = renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-7K3M9P');
      expect(screen.queryByText('Dragging')).toBeNull(); // a press alone is not a drag
      dragTo(520);
      expect(screen.getByText('Dragging')).toBeInTheDocument();
      expect(screen.getByText('Release to move to Won')).toBeInTheDocument();
      expect(column('Won')).toHaveClass('outline-dashed');
      expect(cardById(DANA)).toHaveAttribute('aria-hidden', 'true'); // the gap
      await expectNoAxeViolations(container);

      dragTo(100); // back over its own column: no target
      expect(screen.queryByText(/Release to move to/)).toBeNull();
      expect(column('New')).not.toHaveClass('outline-dashed');
    });

    it('dropping into another column saves that status with the version she saw; the card shows there marked Saving (AC-016.2)', async () => {
      const gate = useMock();
      gate.hold();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-7K3M9P');
      dragTo(520);
      letGo(520);
      await waitFor(() => expect(statusCalls).toEqual([{ id: DANA, body: { to_status: 'won', version: 1 } }]));
      expect(refs('Won')).toContain('NQ-7K3M9P');
      expect(within(card('NQ-7K3M9P')).getByText('Saving')).toBeInTheDocument();
      expect(screen.queryByText('Dragging')).toBeNull();
      gate.release();
      await waitFor(() => expect(screen.getByText('NQ-7K3M9P moved to Won')).toBeInTheDocument());
    });

    it('a failed drop puts the card back and says so (AC-016.13)', async () => {
      useMock();
      server.use(http.post('*/api/quote-requests/:id/status-changes', () => problem(500, 'internal_error', 'Something went wrong')));
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-4HX2RB');
      dragTo(240);
      letGo(240);
      expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
      expect(refs('Quoted')).toEqual(['NQ-9TQ6WD', 'NQ-3FZ8NC']);
    });

    it('Escape cancels the drag: the card is back, nothing is stored, and letting go afterwards does nothing (AC-016.7)', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-7K3M9P');
      dragTo(520);
      expect(screen.getByText('Dragging')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Dragging')).toBeNull();
      expect(card('NQ-7K3M9P')).not.toHaveAttribute('aria-hidden');
      dragTo(530);
      letGo(530);
      expect(statusCalls).toHaveLength(0);
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
      expect(refs('Won')).toEqual(['NQ-6GM2YE', 'NQ-2CJ7XT']);
    });

    it('letting go outside all four columns puts the card back and stores nothing (AC-016.7)', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-7K3M9P');
      dragTo(520);
      dragTo(520, 900); // below the columns
      expect(screen.queryByText(/Release to move to/)).toBeNull();
      letGo(520, 900);
      expect(screen.queryByText('Dragging')).toBeNull();
      expect(statusCalls).toHaveLength(0);
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
    });

    it('dropping a card back into its own column stores nothing (AC-016.6)', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-9TQ6WD');
      dragTo(300);
      letGo(300, 400);
      expect(statusCalls).toHaveLength(0);
      expect(refs('Quoted')).toEqual(['NQ-9TQ6WD', 'NQ-3FZ8NC']);
    });

    it('a press that hardly moves is a click, not a drag: it never saves', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      pick('NQ-7K3M9P');
      fireEvent.pointerMove(window, { ...mouse, clientX: 52, clientY: 151 });
      letGo(520);
      expect(screen.queryByText('Dragging')).toBeNull();
      expect(statusCalls).toHaveLength(0);
    });

    it('the Move to button is never a drag handle, and a finger only drags by the grip', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      placeColumns();
      fireEvent.pointerDown(moveButton('NQ-7K3M9P'), { ...mouse, clientX: 50, clientY: 150 });
      dragTo(520);
      expect(screen.queryByText('Dragging')).toBeNull();
      letGo(520);

      const touch = { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0 } as const;
      fireEvent.pointerDown(within(card('NQ-7K3M9P')).getByText('Dana Whitfield'), { ...touch, clientX: 50, clientY: 150 });
      fireEvent.pointerMove(window, { ...touch, clientX: 520, clientY: 300 });
      expect(screen.queryByText('Dragging')).toBeNull(); // a finger on the card scrolls the page
      fireEvent.pointerUp(window, { ...touch, clientX: 520, clientY: 300 });

      const grip = card('NQ-7K3M9P').querySelector('[data-grip]');
      expect(grip).not.toBeNull();
      fireEvent.pointerDown(grip as Element, { ...touch, clientX: 50, clientY: 150 });
      fireEvent.pointerMove(window, { ...touch, clientX: 520, clientY: 300 });
      expect(screen.getByText('Dragging')).toBeInTheDocument();
      fireEvent.pointerCancel(window, { ...touch, clientX: 520, clientY: 300 });
      expect(screen.queryByText('Dragging')).toBeNull();
      expect(statusCalls).toHaveLength(0);
    });
  });

  describe('mock scenarios on /pipeline (a move on load, from src/mocks)', () => {
    it('save-failed: the move is tried once and refused, the card is back and the message shows', async () => {
      useMock('save-failed');
      renderStaff(
        <PipelinePreviewContext value={{ reference: 'NQ-7K3M9P', to: 'won' }}>
          <PipelineBoard />
        </PipelinePreviewContext>,
      );
      expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
      expect(refs('New')).toEqual(['NQ-7K3M9P', 'NQ-4HX2RB']);
      expect(statusCalls).toHaveLength(1);
    });

    it('moving: the card stays marked Saving in its new column', async () => {
      useMock('moving');
      renderStaff(
        <PipelinePreviewContext value={{ reference: 'NQ-7K3M9P', to: 'won' }}>
          <PipelineBoard />
        </PipelinePreviewContext>,
      );
      await waitFor(() => expect(within(card('NQ-7K3M9P')).getByText('Saving')).toBeInTheDocument());
      expect(refs('Won')).toContain('NQ-7K3M9P');
    });

    it('without a scenario the board does nothing on its own', async () => {
      useMock();
      renderStaff(<PipelineBoard />);
      await loaded();
      expect(statusCalls).toHaveLength(0);
    });
  });
});
