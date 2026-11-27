'use client';

// The signed-in screens' frame (user-flows "Navigation"): providers, the teal top bar with the wordmark, the tabs, "Signed
// in as ..." and Sign out, and the one `main` landmark. Mounted once by src/app/(staff)/layout.tsx, so it stays mounted
// while she moves between Requests, a request and Pipeline: the filter, the search and the scroll of the Requests tab
// (src/hooks/use-list-view.tsx) are still there when she comes back.
import { QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { createStaffQueryClient } from '@/components/staff/staff-query-client';
import { StaffSessionProvider, useStaffSession } from '@/components/staff/staff-session';
import { useStaffMe } from '@/components/staff/queries';
import { TabNav } from '@/components/staff/tab-nav';
import { focusRing } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/site/wordmark';
import { type } from '@/components/ui/typography';
import { Cell } from '@/hooks/cell';
import { ListViewProvider } from '@/hooks/use-list-view';
import { MockProvider } from '@/mocks/mock-provider';
import { cn } from '@/lib/utils';

export function StaffShell({ mocking, children }: { mocking: boolean; children: ReactNode }) {
  // The query client is made before the session provider exists, but a 401 has to reach it: it calls through this ref.
  const [endSession] = useState(() => new Cell<() => Promise<void>>(() => Promise.resolve()));
  const [queryClient] = useState(() => createStaffQueryClient(() => void endSession.get()()));
  const [register] = useState(() => (fn: () => Promise<void>) => endSession.set(fn));

  return (
    <QueryClientProvider client={queryClient}>
      <MockProvider enabled={mocking}>
        <StaffSessionProvider mocking={mocking} registerEndSession={register}>
          <ListViewProvider>
            <Chrome>{children}</Chrome>
          </ListViewProvider>
        </StaffSessionProvider>
      </MockProvider>
    </QueryClientProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  // The phone tab bar is fixed to the bottom: a focused control is never left hidden behind it (design-specs "Brand
  // reference"). The bar is 64 px (DESIGN.md Layout), the same as `h-16` on the nav.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = '4rem';
    return () => {
      root.style.scrollPaddingBottom = before;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col wrap-anywhere">
      <a
        href="#main"
        className={cn(
          'sr-only rounded-md bg-surface px-md py-sm text-text',
          type.label,
          'focus:not-sr-only focus:absolute focus:top-sm focus:left-md focus:z-20',
          focusRing,
        )}
      >
        {staffCopy.nav.skip}
      </a>
      <header className="bg-surface-inverse text-text-inverse">
        <div className="mx-auto flex min-h-16 w-full max-w-320 items-center justify-between gap-md px-md">
          <Link
            href="/requests"
            aria-label={staffCopy.nav.home}
            prefetch={false}
            className={cn('flex shrink-0 rounded-sm py-sm', focusRing, 'focus-visible:outline-focus-on-dark')}
          >
            <Wordmark />
          </Link>
          <TabNav />
          <SignedInAs />
        </div>
      </header>
      <main id="main" className="flex-1 max-sm:pb-16">
        {children}
      </main>
    </div>
  );
}

function SignedInAs() {
  const { signOut } = useStaffSession();
  const me = useStaffMe();
  return (
    <div className="flex flex-none items-center gap-md whitespace-nowrap">
      {me.data ? <span className="hidden text-body-sm sm:inline">{staffCopy.nav.signedInAs(me.data.display_name)}</span> : null}
      <button
        type="button"
        onClick={() => void signOut()}
        className={cn(
          'inline-flex min-h-11 cursor-pointer items-center gap-sm rounded-md border border-text-inverse bg-transparent px-sm text-text-inverse hover:bg-primary-hover',
          type.label,
          focusRing,
          'focus-visible:outline-focus-on-dark',
        )}
      >
        <Icon name="log-out" className="size-4" />
        {staffCopy.nav.signOut}
      </button>
    </div>
  );
}
