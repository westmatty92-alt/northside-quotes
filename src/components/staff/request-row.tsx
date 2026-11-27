// RequestRow (component map): one request, the same six facts in two layouts. From 1024 px it is a row of a six-column
// table (reference, name, urgency, status, submitted, Move to); below that it is a stacked card, so nothing scrolls
// sideways at 375 px. The reference and the name are both links to the request (SCR-06). "Move to" is on every row.
import Link from 'next/link';
import { JobTag } from '@/components/request/job-tag';
import { UrgencyChip } from '@/components/request/urgency-chip';
import { staffCopy } from '@/components/staff/copy';
import { formatSubmitted } from '@/components/staff/format';
import { MoveToMenu } from '@/components/staff/move-to-menu';
import { StatusBadge } from '@/components/staff/status-badge';
import { focusRing } from '@/components/ui/button';
import { type } from '@/components/ui/typography';
import type { QuoteRequestSummary, Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

/** The table's column widths, in 14ths of the row: reference 2, name 3, urgency 2, status 2, submitted 3, Move to 2. */
export const rowGrid = 'grid grid-cols-2 items-center gap-x-md gap-y-sm lg:grid-cols-14';

const link = cn('text-text underline underline-offset-4', focusRing);

interface RequestRowProps {
  row: QuoteRequestSummary;
  /** The href of the request's detail page. */
  href: string;
  /** A status save for this row is running. */
  saving: boolean;
  onMove: (status: Status) => void;
}

export function RequestRow({ row, href, saving, onMove }: RequestRowProps) {
  return (
    <li className={cn(rowGrid, 'border-t border-border p-md first:border-t-0')}>
      <Link href={href} className={cn(link, 'order-1 justify-self-start lg:order-none lg:col-span-2')}>
        <JobTag reference={row.reference} variant="quiet" />
      </Link>
      <Link
        href={href}
        className={cn(link, type.label, 'order-3 col-span-2 text-body-lg lg:order-none lg:col-span-3')}
      >
        {row.name}
      </Link>
      <span className="order-4 justify-self-start lg:order-none lg:col-span-2">
        <UrgencyChip urgency={row.urgency} />
      </span>
      <span className="order-2 justify-self-end lg:order-none lg:col-span-2 lg:justify-self-start">
        <StatusBadge status={row.status} />
      </span>
      <time
        dateTime={row.submitted_at}
        className={cn(type.hint, 'order-5 justify-self-end lg:order-none lg:col-span-3 lg:justify-self-start')}
      >
        {formatSubmitted(row.submitted_at)}
      </time>
      <MoveToMenu
        reference={row.reference}
        current={row.status}
        paused={saving}
        onChoose={onMove}
        className="order-6 col-span-2 lg:order-none lg:col-span-2"
      />
    </li>
  );
}

/** The column titles above the rows (1024 px and up). Decorative: each row's facts carry their own words. */
export function RowHead() {
  return (
    <div aria-hidden="true" className={cn('hidden rounded-t-lg bg-surface-raised px-md py-sm text-text-secondary lg:grid lg:grid-cols-14 lg:gap-x-md', type.labelSm)}>
      <span className="col-span-2">{staffCopy.list.columns[0]}</span>
      <span className="col-span-3">{staffCopy.list.columns[1]}</span>
      <span className="col-span-2">{staffCopy.list.columns[2]}</span>
      <span className="col-span-2">{staffCopy.list.columns[3]}</span>
      <span className="col-span-3">{staffCopy.list.columns[4]}</span>
      <span className="col-span-2" />
    </div>
  );
}
