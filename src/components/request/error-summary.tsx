// ErrorSummary (component map): the list at the top of the form after a refused Send. It takes focus, and each
// item moves focus to its field (a link by shape, a button by behaviour, so it never navigates).
import type { Ref } from 'react';
import { copy } from '@/components/request/copy';
import { Banner } from '@/components/ui/banner';
import { focusRing } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SummaryItem {
  /** The id of the element that receives focus: the field itself, or the first radio, or the photos group. */
  targetId: string;
  text: string;
}

interface ErrorSummaryProps {
  items: readonly SummaryItem[];
  ref?: Ref<HTMLDivElement>;
}

export function ErrorSummary({ items, ref }: ErrorSummaryProps) {
  return (
    <Banner ref={ref} variant="error" titleId="summary-title" title={copy.summary.title(items.length)}>
      <ul className="grid gap-xs">
        {items.map((item) => (
          <li key={item.targetId}>
            <a
              href={`#${item.targetId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(item.targetId)?.focus();
              }}
              className={cn('text-text underline underline-offset-4', focusRing)}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </Banner>
  );
}
