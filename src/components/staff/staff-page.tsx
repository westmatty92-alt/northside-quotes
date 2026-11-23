// What every signed-in screen's content sits in: staff content is up to 1,120 px wide, the Pipeline up to 1,280 px
// (DESIGN.md Layout). The shell supplies the one `main` landmark; this is its measure and rhythm.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StaffPageProps {
  /** The Pipeline's measure (1,280 px). */
  wide?: boolean;
  busy?: boolean;
  children: ReactNode;
}

export function StaffPage({ wide = false, busy = false, children }: StaffPageProps) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn('mx-auto grid w-full gap-lg px-md pt-lg pb-2xl', wide ? 'max-w-320' : 'max-w-280')}
    >
      {children}
    </div>
  );
}
