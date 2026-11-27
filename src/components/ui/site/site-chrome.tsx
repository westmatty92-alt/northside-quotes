// The public pages' chrome (user-flows "Navigation"): a Harbour Teal header with the wordmark and a footer with one
// link, "Staff sign-in". No navigation, no menu. Server component: nothing here needs the browser.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { focusRing } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/site/wordmark';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function SiteChrome({ children }: { children: ReactNode }) {
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
        Skip to main content
      </a>
      <header className="bg-surface-inverse text-text-inverse">
        <div className="mx-auto flex min-h-16 max-w-140 items-center px-md py-sm">
          <Wordmark />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-140 flex-1 px-md py-lg sm:px-lg sm:py-xl">
        {children}
      </main>
      <footer className="mx-auto flex w-full max-w-140 flex-wrap justify-between gap-md px-md pt-lg pb-2xl">
        <span className={type.hint}>Northside Plumbing, Hamilton</span>
        <Link
          href="/sign-in"
          prefetch={false}
          className={cn('text-primary underline underline-offset-4 hover:text-primary-hover', focusRing)}
        >
          Staff sign-in
        </Link>
      </footer>
    </div>
  );
}
