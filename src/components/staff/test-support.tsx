// Shared helpers for the staff screens' component tests (not a test file itself). The screens run exactly as in the app:
// the real staff query client (its 401 handling included), the real session and list-view providers, and the mock API
// of src/mocks/staff-handlers.ts answering through msw; only the router and full-page navigation are stand-ins.
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createStaffQueryClient } from '@/components/staff/staff-query-client';
import { StaffSessionProvider } from '@/components/staff/staff-session';
import { ListViewProvider } from '@/hooks/use-list-view';

export { expectNoAxeViolations } from '@/components/request/test-support';

export interface StaffRender {
  queryClient: QueryClient;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
  container: HTMLElement;
}

/** Render inside the staff providers. `mocking` is the session's mock mode (no bearer token, no Supabase). */
export function renderStaff(ui: ReactElement, { mocking = true }: { mocking?: boolean } = {}): StaffRender {
  let endSession: () => Promise<void> = () => Promise.resolve();
  const queryClient = createStaffQueryClient(() => void endSession());
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } }); // errors show at once
  const wrap = (element: ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <StaffSessionProvider
        mocking={mocking}
        registerEndSession={(fn) => {
          endSession = fn;
        }}
      >
        <ListViewProvider>{element}</ListViewProvider>
      </StaffSessionProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { queryClient, container: view.container, unmount: view.unmount, rerender: (next) => view.rerender(wrap(next)) };
}

/** jsdom has no <dialog> behaviour: showModal() and close() are stood in for (open attribute, then a `close` event). */
export function installDialogStandIn(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
