// @vitest-environment jsdom
// The signed-in frame: the bearer token on every staff call, a session that ends (AC-004.7: sign out FIRST, then SCR-03),
// sign out (AC-004.9), and the two tabs in one navigation landmark with `aria-current` and no List / Board switch.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/components/request/test-support';
import { StaffShell } from '@/components/staff/staff-shell';
import { TabNav, tabForPath } from '@/components/staff/tab-nav';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { getCurrentWeeklyCount } from '@/lib/api/generated/weekly-count/weekly-count';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

const path = vi.hoisted(() => ({ current: '/requests' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const go = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/components/staff/navigation', () => go);

const supabase = vi.hoisted(() => ({
  token: 'token-1' as string | null,
  listeners: [] as Array<(event: string, session: { access_token: string } | null) => void>,
  order: [] as string[],
  signOut: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  getSessionClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: supabase.token ? { access_token: supabase.token } : null } }),
      onAuthStateChange: (listener: (event: string, session: { access_token: string } | null) => void) => {
        supabase.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: supabase.signOut,
    },
  }),
}));

const server = setupServer();
const seen: Array<{ url: string; authorization: string | null }> = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  supabase.token = 'token-1';
  supabase.listeners.length = 0;
  supabase.order.length = 0;
  supabase.signOut.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    supabase.order.push('signed out');
    return { error: null };
  });
  go.navigateTo.mockImplementation(() => supabase.order.push('navigated'));
  seen.length = 0;
  path.current = '/requests';
  server.use(
    http.get('*/api/*', ({ request }) => {
      seen.push({ url: new URL(request.url).pathname, authorization: request.headers.get('Authorization') });
      return undefined; // fall through to the mock API below
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

function problem(status: number) {
  return HttpResponse.json(
    { type: 'about:blank', title: 'Your session ended.', status, code: 'session_expired' },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

describe('the staff frame', () => {
  it('holds the screens back until the session is loaded, then every staff call carries the bearer token', async () => {
    render(<StaffShell mocking={false}>{<p>content</p>}</StaffShell>);
    expect(screen.queryByText('content')).toBeNull();
    expect(await screen.findByText('content')).toBeInTheDocument();
    expect(await screen.findByText('Signed in as Owner')).toBeInTheDocument();
    expect(seen.find((call) => call.url === '/api/staff/me')?.authorization).toBe('Bearer token-1');
  });

  it('reads the CURRENT token on every call: a refreshed token is used by the next call without a re-render', async () => {
    function Ping() {
      const request = useStaffRequest();
      return <button onClick={() => void getCurrentWeeklyCount(request)}>ping</button>;
    }
    render(<StaffShell mocking={false}>{<Ping />}</StaffShell>);
    await screen.findByText('Signed in as Owner');
    fireEvent.click(screen.getByRole('button', { name: 'ping' }));
    await waitFor(() => expect(seen.some((call) => call.url === '/api/weekly-counts/current')).toBe(true));
    for (const listener of supabase.listeners) listener('TOKEN_REFRESHED', { access_token: 'token-2' });
    fireEvent.click(screen.getByRole('button', { name: 'ping' }));
    await waitFor(() => expect(seen.filter((call) => call.url === '/api/weekly-counts/current')).toHaveLength(2));
    expect(seen.filter((call) => call.url === '/api/weekly-counts/current').map((call) => call.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('in mock mode no token is sent and Supabase is never asked', async () => {
    render(<StaffShell mocking={true}>{<p>content</p>}</StaffShell>);
    await screen.findByText('Signed in as Owner');
    expect(seen.find((call) => call.url === '/api/staff/me')?.authorization ?? '').toBe('');
    expect(supabase.signOut).not.toHaveBeenCalled();
  });

  it('a 401 ends the session: supabase.auth.signOut() FINISHES, then SCR-03 opens with the page she was on and the notice', async () => {
    path.current = '/pipeline/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
    server.use(http.get('*/api/staff/me', () => problem(401)));
    render(<StaffShell mocking={false}>{<p>content</p>}</StaffShell>);
    await waitFor(() => expect(go.navigateTo).toHaveBeenCalledTimes(1));
    expect(go.navigateTo).toHaveBeenCalledWith('/sign-in?next=/pipeline/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10&session=ended');
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(supabase.order).toEqual(['signed out', 'navigated']); // the cookies are gone before the page changes, so the proxy cannot loop
  });

  it('several calls failing at once end the session once', async () => {
    server.use(http.get('*/api/*', () => problem(401)));
    render(<StaffShell mocking={false}>{<p>content</p>}</StaffShell>);
    await waitFor(() => expect(go.navigateTo).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(go.navigateTo).toHaveBeenCalledTimes(1);
    expect(supabase.signOut).toHaveBeenCalledTimes(1);
  });

  it('Sign out ends the Supabase session, then goes to SCR-03 (AC-004.9)', async () => {
    render(<StaffShell mocking={false}>{<p>content</p>}</StaffShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(go.navigateTo).toHaveBeenCalledWith('/sign-in'));
    expect(supabase.order).toEqual(['signed out', 'navigated']);
  });

  it('a session that cannot be loaded does not hang the screen: the first call answers 401 and she goes to SCR-03', async () => {
    supabase.token = null;
    server.use(http.get('*/api/*', ({ request }) => (request.headers.get('Authorization') ? undefined : problem(401))));
    render(<StaffShell mocking={false}>{<p>content</p>}</StaffShell>);
    await waitFor(() => expect(go.navigateTo).toHaveBeenCalledWith('/sign-in?next=/requests&session=ended'));
  });
});

describe('TabNav', () => {
  it('has Requests and Pipeline in ONE navigation landmark named Main, and no List / Board switch', async () => {
    path.current = '/requests';
    const { container } = render(<TabNav />);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Requests', 'Pipeline']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/requests', '/pipeline']);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(container.textContent).not.toMatch(/\bBoard\b|\bList\b/);
    await expectNoAxeViolations(container);
  });

  it('marks the current tab aria-current="page" on its own address', () => {
    path.current = '/pipeline';
    render(<TabNav />);
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Requests' })).not.toHaveAttribute('aria-current');
  });

  it('on a request detail the tab she came from is marked aria-current="true", under either tab', () => {
    path.current = '/requests/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
    const first = render(<TabNav />);
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Pipeline' })).not.toHaveAttribute('aria-current');
    first.unmount();
    path.current = '/pipeline/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
    render(<TabNav />);
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'true');
  });

  it('knows which tab an address belongs to', () => {
    expect(tabForPath('/requests')).toBe('requests');
    expect(tabForPath('/requests/abc')).toBe('requests');
    expect(tabForPath('/pipeline/abc')).toBe('pipeline');
    expect(tabForPath('/requestsx')).toBeNull();
    expect(tabForPath('/')).toBeNull();
  });
});
