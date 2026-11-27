// SCR-03 Staff sign-in. Renders per request (the root layout awaits `connection()`; never add `force-static` here).
// `?next=` is untrusted: it is followed only when it passes the allow-list (SECURITY_MODEL invariant 22), otherwise
// sign-in lands on /requests. `?session=ended` makes the page say that her session ended. No footer and no link to
// anything else: the page has one job.
import type { Metadata } from 'next';
import { SignInForm } from '@/components/staff/sign-in-form';
import { safeNextPath } from '@/components/staff/next-path';
import { AppProviders } from '@/components/ui/app-providers';
import { Wordmark } from '@/components/ui/site/wordmark';
import { focusRing } from '@/components/ui/button';
import { type } from '@/components/ui/typography';
import { apiMockingEnabled } from '@/mocks/flag';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Staff sign-in' };

type Param = string | string[] | undefined;
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const ended = first(params.session) === 'ended';

  return (
    <div className="flex min-h-dvh flex-col wrap-anywhere sm:bg-surface-raised">
      <a
        href="#main"
        className={cn(
          'sr-only rounded-md bg-surface px-md py-sm text-text',
          type.label,
          'focus:not-sr-only focus:absolute focus:top-sm focus:left-md focus:z-10',
          focusRing,
        )}
      >
        Skip to sign-in
      </a>
      <header className="bg-surface-inverse text-text-inverse">
        <div className="mx-auto flex min-h-16 max-w-140 items-center px-md py-sm">
          <Wordmark />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-140 flex-1 px-md py-xl sm:py-2xl">
        <div className="mx-auto max-w-110 sm:rounded-lg sm:bg-surface sm:p-lg">
          <AppProviders mocking={apiMockingEnabled()}>
            <SignInForm next={next} ended={ended} />
          </AppProviders>
        </div>
      </main>
    </div>
  );
}
