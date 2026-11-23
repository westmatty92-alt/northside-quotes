'use client';

// SCR-05 Pipeline tab (/pipeline): every request, by status, in four fixed columns (New, Quoted, Won, Lost) under the
// SCR-07 strip. Never filtered, no search (that is the Requests tab), no List / Board switch.
//
// Three ways to move a card, all with the Requests tab's rules and effects (a status change with the version she saw):
//   1. drag it to another column (mouse or finger; Escape or letting go outside the columns puts it back);
//   2. its "Move to" menu (the keyboard and touch path; arrow keys, Enter, Escape);
//   3. either way, the card sits in its new column marked "Saving"; when it works the weekly strip fetches again, focus
//      stays with the card and "NQ-7K3M9P moved to Quoted" is read out; when it does not, the card goes back to its
//      column and its time position, nothing is stored, and a message says so.
//
// Every state of the design: loading skeleton in the real layout, no columns when the board cannot load (so an empty
// column is never mistaken for "no requests"), empty columns, a save that fails, someone else changed it first (Reload),
// and a session that ended (the staff query client sends her to SCR-03).
import { useContext, useEffect, useRef, useState } from 'react';
import { statusLabel } from '@/components/staff/copy';
import { BoardColumn, columnBox, columnHeading, columnIcon } from '@/components/staff/pipeline/board-column';
import { DraggedCard } from '@/components/staff/pipeline/board-card';
import { columnOrder, pipelineCopy } from '@/components/staff/pipeline/copy';
import { PipelinePreviewContext } from '@/components/staff/pipeline/pipeline-preview';
import { useBoardDrag } from '@/components/staff/pipeline/use-board-drag';
import { usePipeline } from '@/components/staff/pipeline/use-pipeline';
import { StaffPage } from '@/components/staff/staff-page';
import { WeekCount } from '@/components/staff/week-count';
import { Banner } from '@/components/ui/banner';
import { Button, focusRing } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { type } from '@/components/ui/typography';
import { Cell } from '@/hooks/cell';
import { cn } from '@/lib/utils';

export function PipelineBoard() {
  const board = usePipeline();
  const { move } = board;
  const { drag, registerColumn, onCardPointerDown } = useBoardDrag((row, to) => void move(row, to, 'drag'));
  const columnsEl = useRef<HTMLDivElement>(null);
  const staleBanner = useRef<HTMLDivElement>(null);

  // After a move from the menu, and after a refused one, focus is on that card's Move to button.
  const { focusRequest } = board;
  useEffect(() => {
    if (!focusRequest) return;
    const cards = Array.from(columnsEl.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []);
    cards.find((card) => card.dataset.card === focusRequest.id)?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
  }, [focusRequest]);

  const stale = board.failure?.kind === 'stale';
  useEffect(() => {
    if (stale) staleBanner.current?.focus();
  }, [stale]);

  // Mock mode only: a scenario can ask for one move once the board has loaded (src/mocks/**). Nothing provides this in
  // a normal run.
  const preview = useContext(PipelinePreviewContext);
  const [previewed] = useState(() => new Cell(false));
  const { columns, loading, failed } = board;
  useEffect(() => {
    if (!preview || previewed.get() || loading || failed) return;
    const row = columns.flatMap((column) => column.rows).find((candidate) => candidate.reference === preview.reference);
    if (!row) return;
    previewed.set(true);
    void move(row, preview.to, 'menu');
  }, [preview, previewed, loading, failed, columns, move]);

  const ready = !loading && !failed;

  return (
    <StaffPage wide busy={loading}>
      <h1 className={type.h1}>{pipelineCopy.title}</h1>

      <WeekCount />

      {ready ? (
        <div className="grid gap-md">
          <p className={type.hint}>{pipelineCopy.about}</p>
          <nav
            aria-label={pipelineCopy.jump}
            className="flex overflow-hidden rounded-md border border-border-strong bg-surface sm:hidden"
          >
            {columnOrder.map((status) => (
              <a
                key={status}
                href={`#col-${status}`}
                className={cn(
                  'flex min-h-11 flex-1 items-center justify-center border-l border-border px-sm whitespace-nowrap text-text first:border-l-0 hover:bg-surface-raised',
                  type.label,
                  focusRing,
                  'focus-visible:-outline-offset-3',
                )}
              >
                {statusLabel[status]}
              </a>
            ))}
          </nav>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {loading ? pipelineCopy.loading : board.announcement}
      </p>

      {board.failure?.kind === 'save' ? (
        <Banner variant="error" titleId="board-failure" title={pipelineCopy.saveFailed}>
          <p>{pipelineCopy.saveFailedBody(board.failure.reference, statusLabel[board.failure.status])}</p>
        </Banner>
      ) : board.failure?.kind === 'stale' ? (
        <Banner ref={staleBanner} variant="warning" titleId="board-failure" title={pipelineCopy.stale}>
          <p>{pipelineCopy.staleBody(board.failure.reference)}</p>
          <Button onClick={() => void board.reload()}>
            <Icon name="refresh" className="size-4" />
            {pipelineCopy.reload}
          </Button>
        </Banner>
      ) : null}

      {loading ? (
        <BoardSkeleton />
      ) : failed ? (
        <Banner variant="error" titleId="board-error" title={pipelineCopy.loadFailed}>
          <p>{pipelineCopy.loadFailedBody}</p>
          <Button onClick={() => void board.retry()} paused={board.fetching}>
            <Icon name="refresh" className="size-4" />
            {pipelineCopy.retry}
          </Button>
        </Banner>
      ) : (
        <div ref={columnsEl} className={cn('grid gap-md sm:grid-cols-2 xl:grid-cols-4', drag && 'cursor-grabbing select-none')}>
          {board.columns.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              liftedId={drag?.row.id ?? null}
              target={drag !== null && drag.over === column.status && drag.from !== column.status}
              register={registerColumn(column.status)}
              onMove={(row, to) => void move(row, to, 'menu')}
              onPointerDown={onCardPointerDown}
            />
          ))}
        </div>
      )}

      {drag ? <DraggedCard row={drag.row} x={drag.x - drag.grabX} y={drag.y - drag.grabY} width={drag.width} /> : null}
    </StaffPage>
  );
}

/** Four skeleton columns with skeleton cards, in the real layout's shape. Decorative: "Loading the board" is announced. */
function BoardSkeleton() {
  const cards: Record<(typeof columnOrder)[number], number> = { new: 2, quoted: 2, won: 1, lost: 1 };
  return (
    <div aria-hidden="true" className="grid gap-md sm:grid-cols-2 xl:grid-cols-4">
      {columnOrder.map((status) => (
        <section key={status} className={columnBox}>
          <h2 className={cn('flex items-center gap-sm p-xs', columnHeading)}>
            <Icon name={columnIcon[status]} />
            {statusLabel[status]}
          </h2>
          <ul className="grid gap-sm">
            {Array.from({ length: cards[status] }, (_, index) => (
              <li key={index} className="grid gap-sm rounded-md border border-border bg-surface p-md">
                <Skeleton size="block" className="w-32" />
                <Skeleton className="w-40" />
                <Skeleton className="w-24" />
                <Skeleton size="block" className="min-h-11" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
