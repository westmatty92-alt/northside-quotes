'use client';

// BoardCard (component map): one request in a column. The reference tag (a link to the request), the name, urgency
// (icon and word), the submitted time in Hamilton time and a full-width "Move to" button, 44 px high, always visible.
// States: default; saving (marked "Saving", its Move to button paused, so one press makes one save); the gap it leaves
// behind while it is being dragged. `DraggedCard` is the picture that follows the pointer, wearing the copper outline
// and the word "Dragging".
import Link from 'next/link';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { JobTag } from '@/components/request/job-tag';
import { UrgencyChip } from '@/components/request/urgency-chip';
import { formatSubmitted } from '@/components/staff/format';
import { MoveToMenu } from '@/components/staff/move-to-menu';
import { pipelineCopy } from '@/components/staff/pipeline/copy';
import { GripIcon, MoveIcon } from '@/components/staff/pipeline/pipeline-icons';
import type { BoardRow } from '@/components/staff/pipeline/use-pipeline';
import { focusRing } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import type { Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

const card = 'relative grid gap-sm rounded-md border bg-surface p-md';
const stateLabel = cn('inline-flex items-center gap-xs', type.labelSm);

interface BoardCardProps {
  row: BoardRow;
  /** This card is being dragged: it leaves a dashed gap the size of the card. */
  lifted: boolean;
  onMove: (status: Status) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, row: BoardRow) => void;
}

export function BoardCard({ row, lifted, onMove, onPointerDown }: BoardCardProps) {
  return (
    <li
      data-card={row.id}
      aria-hidden={lifted || undefined}
      onPointerDown={(event) => onPointerDown(event, row)}
      onDragStart={(event) => event.preventDefault()}
      className={cn(
        card,
        'sm:cursor-grab',
        lifted ? 'border-dashed border-border-strong bg-transparent' : 'border-border',
        row.saving && 'bg-surface-raised',
      )}
    >
      <div inert={lifted} className={cn('grid gap-sm', lifted && 'invisible')}>
        <div className="flex items-center justify-between gap-sm">
          <Link
            href={`/pipeline/${row.id}`}
            draggable={false}
            className={cn('rounded-sm text-text underline underline-offset-4', focusRing)}
          >
            <JobTag reference={row.reference} variant="quiet" />
          </Link>
          {row.saving ? (
            <span role="status" className={cn(stateLabel, 'text-text')}>
              <Icon name="refresh" className="size-4 motion-safe:animate-spin" />
              {pipelineCopy.saving}
            </span>
          ) : (
            <span data-grip aria-hidden="true" className="hidden touch-none text-text-secondary xl:inline-flex">
              <GripIcon />
            </span>
          )}
        </div>
        <p className={cn(type.label, 'text-body-lg leading-snug')}>{row.name}</p>
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <UrgencyChip urgency={row.urgency} />
          <time dateTime={row.submitted_at} className={type.hint}>
            {formatSubmitted(row.submitted_at)}
          </time>
        </div>
        <MoveToMenu reference={row.reference} current={row.status} paused={row.saving} onChoose={onMove} />
      </div>
    </li>
  );
}

/** What follows the pointer during a drag: the card's facts under the copper outline, no buttons. Decorative. */
export function DraggedCard({ row, x, y, width }: { row: BoardRow; x: number; y: number; width: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ left: x, top: y, width }}
      className={cn(card, 'pointer-events-none fixed z-30 border-2 border-accent')}
    >
      <div className="flex items-center justify-between gap-sm">
        <JobTag reference={row.reference} variant="quiet" />
        <span className={cn(stateLabel, 'text-text')}>
          <MoveIcon className="size-4" />
          {pipelineCopy.dragging}
        </span>
      </div>
      <p className={cn(type.label, 'text-body-lg leading-snug')}>{row.name}</p>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <UrgencyChip urgency={row.urgency} />
        <time dateTime={row.submitted_at} className={type.hint}>
          {formatSubmitted(row.submitted_at)}
        </time>
      </div>
    </div>
  );
}
