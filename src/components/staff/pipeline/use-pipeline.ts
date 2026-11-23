'use client';

// The Pipeline tab's data and its one write. Reads: ONE listQuoteRequests call per column, by status, never `q` (the
// board shows every request), 50 at a time with "Show more" for that column only. Write: changeQuoteRequestStatus with
// the version she saw, from a drag or from a card's "Move to" menu (the same rules and effects as on the Requests tab).
//
// A card that was just moved sits in its new column at once, marked "Saving" (`BoardRow.saving`). That is not server data
// copied into state: `moves` only says "this card is on its way to that column", and the columns are worked out from the
// query cache plus those notes during render. When the save fails the note is dropped and the card is back where the
// cache says it is, in its own time position, with nothing stored. When it works the note stays until the columns have
// been fetched again, so the card never vanishes between the two fetches.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { statusLabel } from '@/components/staff/copy';
import { useRequestList, listQueryPrefix } from '@/components/staff/queries';
import { columnOrder, pipelineCopy } from '@/components/staff/pipeline/copy';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { isApiProblem } from '@/lib/api/fetcher';
import { useChangeQuoteRequestStatus } from '@/lib/api/generated/inbox/inbox';
import { ChangeQuoteRequestStatusResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { getGetCurrentWeeklyCountQueryKey } from '@/lib/api/generated/weekly-count/weekly-count';
import type { QuoteRequestSummary, Status } from '@/lib/api/generated/model';

export interface BoardRow extends QuoteRequestSummary {
  /** The save for this card is running. */
  saving: boolean;
}

export interface BoardColumn {
  status: Status;
  rows: BoardRow[];
  hasMore: boolean;
  loadingMore: boolean;
  showMore: () => void;
}

export type BoardFailure = { kind: 'save'; reference: string; status: Status } | { kind: 'stale'; reference: string };

/** How a move was asked for: the menu is the keyboard path, so it keeps focus on the card. */
export type MoveVia = 'menu' | 'drag';

interface Move {
  row: QuoteRequestSummary;
  to: Status;
  version: number;
  phase: 'saving' | 'saved';
}

export interface FocusRequest {
  id: string;
  n: number;
}

function without(moves: Readonly<Record<string, Move>>, id: string): Record<string, Move> {
  return Object.fromEntries(Object.entries(moves).filter(([key]) => key !== id));
}

/** Submitted time, newest first, then id: the order the API lists in. A moved card takes its time position. */
function newestFirst(a: QuoteRequestSummary, b: QuoteRequestSummary): number {
  return b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id);
}

export function usePipeline() {
  const request = useStaffRequest();
  const queryClient = useQueryClient();
  const change = useChangeQuoteRequestStatus({ request });

  // One query per column, started together (never one after the other).
  const lists = {
    new: useRequestList({ status: 'new' }),
    quoted: useRequestList({ status: 'quoted' }),
    won: useRequestList({ status: 'won' }),
    lost: useRequestList({ status: 'lost' }),
  } satisfies Record<Status, ReturnType<typeof useRequestList>>;

  const [moves, setMoves] = useState<Readonly<Record<string, Move>>>({});
  const [failure, setFailure] = useState<BoardFailure | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const all = columnOrder.map((status) => lists[status]);
  const failed = all.some((list) => list.isError && list.data === undefined);
  const loading = !failed && all.some((list) => list.isPending);

  const columns: BoardColumn[] = columnOrder.map((status) => {
    const list = lists[status];
    const staying = (list.data?.rows ?? []).filter((row) => !(row.id in moves));
    const arriving = Object.values(moves)
      .filter((move) => move.to === status)
      .map((move): QuoteRequestSummary => ({ ...move.row, status, version: move.version }));
    const rows = [...staying, ...arriving].sort(newestFirst).map((row): BoardRow => ({ ...row, saving: moves[row.id]?.phase === 'saving' }));
    return {
      status,
      rows,
      hasMore: list.hasNextPage,
      loadingMore: list.isFetchingNextPage,
      showMore: () => void list.fetchNextPage(),
    };
  });

  const requestFocus = (id: string) => setFocusRequest((current) => ({ id, n: (current?.n ?? 0) + 1 }));

  async function refreshAll(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetCurrentWeeklyCountQueryKey() }),
      queryClient.invalidateQueries({ queryKey: listQueryPrefix }, { throwOnError: true }),
    ]);
  }

  async function move(row: BoardRow, to: Status, via: MoveVia): Promise<void> {
    const previous = moves[row.id];
    if (row.saving || row.status === to) return; // one press, one save; the status it already has stores nothing
    setFailure(null);
    setAnnouncement('');
    setMoves((current) => ({ ...current, [row.id]: { row, to, version: row.version, phase: 'saving' } }));
    if (via === 'menu') requestFocus(row.id);
    try {
      const response = await change.mutateAsync({ requestId: row.id, data: { to_status: to, version: row.version } });
      const result = ChangeQuoteRequestStatusResponse.parse(response.data);
      setMoves((current) => ({ ...current, [row.id]: { row, to: result.status, version: result.version, phase: 'saved' } }));
      setAnnouncement(pipelineCopy.moved(row.reference, statusLabel[result.status]));
    } catch (error) {
      // the card goes back to its column and its time position; nothing is stored
      setMoves((current) => (previous ? { ...without(current, row.id), [row.id]: previous } : without(current, row.id)));
      requestFocus(row.id);
      if (isApiProblem(error) && error.status === 401) return; // the session ended: the mutation cache takes her to SCR-03
      setFailure(
        isApiProblem(error) && error.code === 'stale_version'
          ? { kind: 'stale', reference: row.reference }
          : { kind: 'save', reference: row.reference, status: row.status },
      );
      return;
    }
    // saved: the weekly strip and the columns fetch again; the note goes once the columns agree
    try {
      await refreshAll();
      setMoves((current) => (current[row.id]?.phase === 'saved' ? without(current, row.id) : current));
    } catch {
      // the columns could not be fetched again: the card stays where she put it, which is where the server has it
    }
  }

  /** "Reload" after someone else changed a request first: forget every note and fetch the board again. */
  async function reload(): Promise<void> {
    setFailure(null);
    setMoves({});
    await Promise.all(all.map((list) => list.refetch())).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: getGetCurrentWeeklyCountQueryKey() });
  }

  async function retry(): Promise<void> {
    await Promise.all(all.filter((list) => list.isError).map((list) => list.refetch())).catch(() => undefined);
  }

  return {
    columns,
    loading,
    failed,
    fetching: all.some((list) => list.isFetching),
    failure,
    announcement,
    focusRequest,
    move,
    reload,
    retry,
  };
}
