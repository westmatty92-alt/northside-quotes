'use client';

// TabNav (component map): two tabs, Requests and Pipeline, each its own address, in ONE navigation landmark named
// "Main". From 640 px the tabs sit in the teal top bar beside the wordmark; below it the same landmark is fixed to the
// bottom of the screen as a 64 px tab bar (icon above label). The current tab is `aria-current="page"` on its own
// address; on a request detail the tab she came from is `aria-current="true"` (a detail page is not a tab itself).
// Never colour alone: an underline on the teal bar, a teal top bar plus bold teal label on the phone bar.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { staffCopy } from '@/components/staff/copy';
import { focusRing } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const tabs = [
  { key: 'requests', href: '/requests', label: staffCopy.nav.requests, icon: 'list' },
  { key: 'pipeline', href: '/pipeline', label: staffCopy.nav.pipeline, icon: 'board' },
] as const satisfies readonly { key: string; href: string; label: string; icon: IconName }[];

export type TabKey = (typeof tabs)[number]['key'];

/** Which tab an address belongs to: `/requests`, `/requests/<id>` -> requests; `/pipeline...` -> pipeline. */
export function tabForPath(pathname: string): TabKey | null {
  if (pathname === '/requests' || pathname.startsWith('/requests/')) return 'requests';
  if (pathname === '/pipeline' || pathname.startsWith('/pipeline/')) return 'pipeline';
  return null;
}

export function TabNav() {
  const pathname = usePathname();
  const current = tabForPath(pathname);
  return (
    <nav
      aria-label={staffCopy.nav.label}
      className={cn(
        // phones: the bottom tab bar, fixed (content keeps room for it, see StaffShell)
        'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:flex max-sm:h-16 max-sm:border-t max-sm:border-border-strong max-sm:bg-surface',
        // 640 px and up: inside the teal bar, beside the wordmark
        'sm:mr-auto sm:ml-lg sm:flex sm:items-stretch sm:gap-xs sm:self-stretch',
      )}
    >
      {tabs.map((tab) => {
        const isCurrent = current === tab.key;
        const aria = isCurrent ? (pathname === tab.href ? 'page' : 'true') : undefined;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={aria}
            prefetch={false}
            className={cn(
              'flex items-center no-underline',
              focusRing,
              // phone tab
              'max-sm:flex-1 max-sm:flex-col max-sm:justify-center max-sm:gap-xs max-sm:border-t-4 max-sm:p-sm max-sm:text-text-secondary max-sm:focus-visible:-outline-offset-3',
              type.labelSm,
              isCurrent
                ? 'max-sm:border-t-primary max-sm:bg-surface-raised max-sm:text-primary'
                : 'max-sm:border-t-transparent',
              // top-bar tab
              'sm:gap-sm sm:border-y-4 sm:border-y-transparent sm:px-md sm:text-ui-label sm:text-text-inverse sm:focus-visible:outline-focus-on-dark',
              'sm:font-(weight:--font-weight-ui-label) sm:tracking-normal sm:hover:bg-primary-hover',
              isCurrent && 'sm:border-b-text-inverse',
            )}
          >
            <Icon name={tab.icon} className="size-5 sm:size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
