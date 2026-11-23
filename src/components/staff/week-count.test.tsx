// @vitest-environment jsdom
// SCR-07: the three numbers, zero (never blank), loading in the same shape, "Count unavailable" with Try again, and a number
// that changes in place with a polite "Won 2". The API is the mock API through msw, with overrides for each state.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderStaff } from '@/components/staff/test-support';
import { WeekCount } from '@/components/staff/week-count';
import { getGetCurrentWeeklyCountQueryKey } from '@/lib/api/generated/weekly-count/weekly-count';
import { WEEK } from '@/mocks/staff-data';

vi.mock('next/navigation', () => ({ usePathname: () => '/requests', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

const counts = (requests: number, won: number, lost: number) => http.get('*/api/weekly-counts/current', () => HttpResponse.json({ ...WEEK, requests, won, lost }));

function tile(name: string) {
  return screen.getByText(name).closest('li') as HTMLElement;
}

describe('SCR-07 Weekly count', () => {
  it('Success: THIS WEEK, the dates in Hamilton time, and the three numbers with their words', async () => {
    server.use(counts(4, 1, 1));
    const { container } = renderStaff(<WeekCount />);
    expect(await screen.findByText('Mon Nov 16 to Sun Nov 22, Hamilton time')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'THIS WEEK' })).toBeInTheDocument();
    expect(within(tile('Requests this week')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Won')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Lost')).getByText('1')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('Empty: a week with no activity shows 0, 0 and 0, never blank', async () => {
    server.use(counts(0, 0, 0));
    renderStaff(<WeekCount />);
    await screen.findByText('Requests this week');
    expect(within(tile('Requests this week')).getByText('0')).toBeInTheDocument();
    expect(within(tile('Won')).getByText('0')).toBeInTheDocument();
    expect(within(tile('Lost')).getByText('0')).toBeInTheDocument();
  });

  it('Loading: three skeleton tiles and a status word, then the numbers', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.get('*/api/weekly-counts/current', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ ...WEEK, requests: 4, won: 1, lost: 1 });
      }),
    );
    const { container } = renderStaff(<WeekCount />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the weekly count');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expectNoAxeViolations(container);
    release();
    expect(await screen.findByText('Requests this week')).toBeInTheDocument();
  });

  it('Error: "Count unavailable" with Try again, which asks again and shows the numbers', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/weekly-counts/current', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ type: 'about:blank', title: 'Something went wrong', status: 500, code: 'internal_error' }, { status: 500, headers: { 'Content-Type': 'application/problem+json' } })
          : HttpResponse.json({ ...WEEK, requests: 2, won: 0, lost: 0 });
      }),
    );
    const { container } = renderStaff(<WeekCount />);
    expect(await screen.findByText('Count unavailable')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Requests this week')).toBeInTheDocument();
    expect(within(tile('Requests this week')).getByText('2')).toBeInTheDocument();
  });

  it('a body that breaks the contract shows "Count unavailable" instead of crashing', async () => {
    server.use(http.get('*/api/weekly-counts/current', () => HttpResponse.json({ requests: 'four' })));
    renderStaff(<WeekCount />);
    expect(await screen.findByText('Count unavailable')).toBeInTheDocument();
  });

  it('a number that changes updates in place, is announced politely ("Won 2"), and its tile is outlined for a moment', async () => {
    let won = 1;
    server.use(http.get('*/api/weekly-counts/current', () => HttpResponse.json({ ...WEEK, requests: 4, won, lost: 1 })));
    const { queryClient } = renderStaff(<WeekCount />);
    await screen.findByText('Requests this week');
    const announcer = document.querySelector('p[role="status"][aria-live="polite"]') as HTMLElement;
    expect(announcer).toHaveTextContent('');

    won = 2;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: getGetCurrentWeeklyCountQueryKey() });
    });
    await waitFor(() => expect(within(tile('Won')).getByText('2')).toBeInTheDocument());
    expect(announcer).toHaveTextContent('Won 2');
    expect(tile('Won').className).toContain('outline-success');
    expect(tile('Lost').className).not.toContain('outline-success');
  });
});
