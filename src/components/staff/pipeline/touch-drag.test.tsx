// @vitest-environment jsdom
// SQ-9 (AC-016.2): a finger drag by the grip moves a card on the board, as src/components/staff/pipeline/use-board-drag.ts
// designs it. pipeline-board.test.tsx only starts a touch drag and cancels it; these tests lift the finger over another
// column and check what is saved. jsdom has no touch input and no layout: the pointer events are sent by hand with
// `pointerType: 'touch'` and the columns are given places on the screen. What jsdom cannot show (the grip is only
// displayed from 1280 px up; what the browser does with a touch that starts on it) is in the FE2 report.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineBoard } from '@/components/staff/pipeline/pipeline-board';
import { renderStaff } from '@/components/staff/test-support';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

vi.mock('next/navigation', () => ({ usePathname: () => '/pipeline', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/staff/navigation', () => ({ navigateTo: vi.fn() }));

const server = setupServer();
const statusCalls: Array<{ id: string; body: { to_status: string; version: number } }> = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  statusCalls.length = 0;
  server.use(
    http.post('*/api/quote-requests/:id/status-changes', async ({ request, params }) => {
      statusCalls.push({ id: String(params.id), body: (await request.clone().json()) as { to_status: string; version: number } });
      return undefined; // the mock API answers
    }),
    ...buildStaffHandlers('signed-in'),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const DANA = 'a0000000-0000-4000-8000-000000000001';
const column = (name: string) => screen.getByRole('region', { name });
const refs = (name: string) => within(column(name)).queryAllByRole('link').map((link) => link.textContent);
const card = (reference: string) => screen.getByRole('link', { name: reference }).closest('li') as HTMLElement;
const gripOf = (reference: string) => card(reference).querySelector('[data-grip]') as Element;

function placeColumns() {
  const places = { New: 0, Quoted: 220, Won: 440, Lost: 660 };
  for (const [name, left] of Object.entries(places)) {
    column(name).getBoundingClientRect = () => ({ left, right: left + 200, top: 100, bottom: 700, width: 200, height: 600, x: left, y: 100, toJSON: () => ({}) });
  }
}
async function loaded() {
  await screen.findByRole('link', { name: 'NQ-7K3M9P' });
  await screen.findByText('Requests this week');
  placeColumns();
}

const finger = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 } as const;
const touchDown = (target: Element, x = 50, y = 150) => fireEvent.pointerDown(target, { ...finger, clientX: x, clientY: y });
const touchMove = (x: number, y = 300) => fireEvent.pointerMove(window, { ...finger, clientX: x, clientY: y });
const touchUp = (x: number, y = 300) => fireEvent.pointerUp(window, { ...finger, clientX: x, clientY: y });

describe('a finger drag by the grip (SQ-9, AC-016.2)', () => {
  it('lifting the finger over Won saves Won with the version she saw, and the card moves there', async () => {
    renderStaff(<PipelineBoard />);
    await loaded();
    touchDown(gripOf('NQ-7K3M9P'));
    touchMove(520);
    expect(screen.getByText('Dragging')).toBeInTheDocument();
    expect(screen.getByText('Release to move to Won')).toBeInTheDocument();
    touchUp(520);
    await waitFor(() => expect(statusCalls).toEqual([{ id: DANA, body: { to_status: 'won', version: 1 } }]));
    expect(refs('Won')).toContain('NQ-7K3M9P');
    expect(refs('New')).not.toContain('NQ-7K3M9P');
    expect(screen.queryByText('Dragging')).toBeNull();
    await waitFor(() => expect(screen.getByText('NQ-7K3M9P moved to Won')).toBeInTheDocument());
  });

  it('works from every column to every other (a finger by the grip, New to Quoted and Quoted to Lost)', async () => {
    renderStaff(<PipelineBoard />);
    await loaded();
    touchDown(gripOf('NQ-4HX2RB'));
    touchMove(240);
    touchUp(240);
    await waitFor(() => expect(refs('Quoted')).toContain('NQ-4HX2RB'));
    await waitFor(() => expect(screen.getByText('NQ-4HX2RB moved to Quoted')).toBeInTheDocument());
    touchDown(gripOf('NQ-9TQ6WD'), 250, 150);
    touchMove(700);
    touchUp(700);
    await waitFor(() => expect(refs('Lost')).toContain('NQ-9TQ6WD'));
    expect(statusCalls.map((call) => call.body.to_status)).toEqual(['quoted', 'lost']);
  });

  it('a touch that the browser takes over for scrolling (pointercancel) puts the card back and stores nothing', async () => {
    renderStaff(<PipelineBoard />);
    await loaded();
    touchDown(gripOf('NQ-7K3M9P'));
    touchMove(520);
    fireEvent.pointerCancel(window, { ...finger, clientX: 520, clientY: 300 });
    expect(screen.queryByText('Dragging')).toBeNull();
    expect(statusCalls).toHaveLength(0);
    expect(refs('New')).toContain('NQ-7K3M9P');
  });

  it('another finger or pointer does not steer the drag or drop the card', async () => {
    renderStaff(<PipelineBoard />);
    await loaded();
    touchDown(gripOf('NQ-7K3M9P'));
    touchMove(520);
    fireEvent.pointerUp(window, { pointerId: 8, pointerType: 'touch', isPrimary: false, clientX: 520, clientY: 300 });
    expect(screen.getByText('Dragging')).toBeInTheDocument();
    expect(statusCalls).toHaveLength(0);
    touchUp(520);
    await waitFor(() => expect(statusCalls).toHaveLength(1));
  });

  it('the grip stops the browser from scrolling under the finger (touch-action: none), the rest of the card does not drag', async () => {
    renderStaff(<PipelineBoard />);
    await loaded();
    expect(gripOf('NQ-7K3M9P')).toHaveClass('touch-none');
    touchDown(within(card('NQ-7K3M9P')).getByText('Dana Whitfield')); // the name, not the grip: the page scrolls
    touchMove(520);
    expect(screen.queryByText('Dragging')).toBeNull();
    touchUp(520);
    expect(statusCalls).toHaveLength(0);
  });
});
