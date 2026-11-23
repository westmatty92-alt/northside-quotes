'use client';

// BoardColumn (component map): a fixed column (New, Quoted, Won or Lost) with its cards, newest first. Nothing about a
// column can be changed: no add, rename, recolour, remove or reorder control exists. An empty column keeps its place
// and is still a valid place to move a card to. While a card is dragged over it, the column is dashed and says
// "Release to move to <status>". More than 50 cards: "Show more" for this column only.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { statusLabel } from '@/components/staff/copy';
import { BoardCard } from '@/components/staff/pipeline/board-card';
import { pipelineCopy } from '@/components/staff/pipeline/copy';
import type { BoardColumn as BoardColumnData, BoardRow } from '@/components/staff/pipeline/use-pipeline';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import type { Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

export const columnIcon: Record<Status, IconName> = { new: 'inbox', quoted: 'doc', won: 'check-circle', lost: 'x-circle' };

export const columnHeading = 'font-h3 font-(weight:--font-weight-h3) text-h3 leading-tight';
export const columnBox = 'grid min-w-0 content-start gap-sm rounded-lg bg-surface-raised p-md';

interface BoardColumnProps {
  column: BoardColumnData;
  /** The card being dragged, if any: its place in this column is a gap. */
  liftedId: string | null;
  /** A card from another column is being dragged over this one. */
  target: boolean;
  register: (node: HTMLElement | null) => void;
  onMove: (row: BoardRow, status: Status) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, row: BoardRow) => void;
}

export function BoardColumn({ column, liftedId, target, register, onMove, onPointerDown }: BoardColumnProps) {
  const { status } = column;
  const label = statusLabel[status];
  return (
    <section
      ref={register}
      id={`col-${status}`}
      aria-labelledby={`h-${status}`}
      className={cn(columnBox, target && 'outline-2 -outline-offset-4 outline-dashed outline-border-strong')}
    >
      <h2 id={`h-${status}`} className={cn('flex items-center gap-sm p-xs', columnHeading)}>
        <Icon name={columnIcon[status]} />
        {label}
      </h2>
      {column.rows.length === 0 && !target ? (
        <p className="flex items-center gap-sm rounded-md border border-dashed border-border-strong bg-surface p-md text-text-secondary">
          <Icon name={columnIcon[status]} className="size-4" />
          {pipelineCopy.empty[status]}
        </p>
      ) : (
        <ul className="grid gap-sm">
          {target ? (
            <li
              aria-hidden="true"
              className="flex items-center gap-sm rounded-md border-2 border-dashed border-border-strong bg-surface p-md font-(weight:--font-weight-ui-label)"
            >
              <Icon name="down" className="size-4" />
              {pipelineCopy.release(label)}
            </li>
          ) : null}
          {column.rows.map((row) => (
            <BoardCard key={row.id} row={row} lifted={row.id === liftedId} onMove={(to) => onMove(row, to)} onPointerDown={onPointerDown} />
          ))}
          {column.hasMore ? (
            <li>
              <Button block paused={column.loadingMore} onClick={column.showMore}>
                {column.loadingMore ? pipelineCopy.loadingMore : pipelineCopy.showMore}
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
