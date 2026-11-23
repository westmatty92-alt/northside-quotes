'use client';

// SCR-04 Requests tab: every request, newest first, 50 at a time ("Show more" asks for the next 50), with the SCR-07
// strip above, a status filter and a search. Filter and search are client state (src/hooks/use-list-view.tsx), not part
// of the address. Changing a status here never moves the row (the order is by submitted time only); with a filter on,
// the row leaves the list without a reload.
//
// Every state of the design: loading skeleton in the real layout, first use, a filter or search with nothing in it,
// the list cannot load (the list is NOT shown, so it is not mistaken for an empty filter), a status save that fails
// ("Couldn't save. Try again.", the row keeps its old status), someone else changed it first (Reload), and a session
// that ended (the staff query client sends her to SCR-03).
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { staffCopy, statusLabel, statusOrder } from '@/components/staff/copy';
import { listQueryPrefix, useRequestList } from '@/components/staff/queries';
import { RequestRow, RowHead, rowGrid } from '@/components/staff/request-row';
import { StaffPage } from '@/components/staff/staff-page';
import { WeekCount } from '@/components/staff/week-count';
import { Banner } from '@/components/ui/banner';
import { Button, focusRing } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { type } from '@/components/ui/typography';
import { Cell } from '@/hooks/cell';
import { useListView, type StatusFilter } from '@/hooks/use-list-view';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { isApiProblem } from '@/lib/api/fetcher';
import { useChangeQuoteRequestStatus } from '@/lib/api/generated/inbox/inbox';
import { ChangeQuoteRequestStatusResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { getGetCurrentWeeklyCountQueryKey } from '@/lib/api/generated/weekly-count/weekly-count';
import type { QuoteRequestPage, QuoteRequestSummary, Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

type Failure = { kind: 'save'; reference: string; status: Status } | { kind: 'stale' };

const filters: readonly StatusFilter[] = ['all', ...statusOrder];
const filterLabel = (filter: StatusFilter) => (filter === 'all' ? staffCopy.list.filterAll : statusLabel[filter]);

export function RequestsList() {
  const view = useListView();
  const request = useStaffRequest();
  const queryClient = useQueryClient();
  const list = useRequestList({ ...(view.status === 'all' ? {} : { status: view.status }), q: view.applied });
  const change = useChangeQuoteRequestStatus({ request });
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<Failure | null>(null);
  const [moved, setMoved] = useState('');
  const failureBanner = useRef<HTMLDivElement>(null);

  // A row she moved out of the filter leaves the list at once; the refetch below confirms it.
  const rows = (list.data?.rows ?? []).filter((row) => view.status === 'all' || row.status === view.status);

  // Back from a request: the scroll position she left (the filter and search are still in `view`).
  const { takeScroll, rememberScroll } = view;
  const [restored] = useState(() => new Cell(false));
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (restored.get() || !hasRows) return;
    restored.set(true); // once per visit to the list
    const y = takeScroll();
    if (y > 0) window.scrollTo(0, y);
  }, [restored, hasRows, takeScroll]);

  useEffect(() => {
    if (failure) failureBanner.current?.focus();
  }, [failure]);

  async function move(row: QuoteRequestSummary, to: Status) {
    if (saving.has(row.id) || row.status === to) return; // choosing the status it already has does nothing
    setFailure(null);
    setSaving((current) => new Set(current).add(row.id));
    try {
      const response = await change.mutateAsync({ requestId: row.id, data: { to_status: to, version: row.version } });
      const result = ChangeQuoteRequestStatusResponse.parse(response.data);
      // the row shows its new status and version in place; it keeps its position
      queryClient.setQueriesData<InfiniteData<QuoteRequestPage>>(
        { queryKey: listQueryPrefix, predicate: (query) => query.queryKey.at(-1) === 'pages' },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              data: page.data.map((item) => (item.id === row.id ? { ...item, status: result.status, version: result.version } : item)),
            })),
          },
      );
      setMoved(staffCopy.list.moved(row.reference, statusLabel[result.status]));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetCurrentWeeklyCountQueryKey() }),
        queryClient.invalidateQueries({ queryKey: listQueryPrefix }),
      ]);
    } catch (error) {
      if (isApiProblem(error) && error.status === 401) return; // the session ended: the mutation cache takes her to SCR-03
      setFailure(
        isApiProblem(error) && error.code === 'stale_version'
          ? { kind: 'stale' }
          : { kind: 'save', reference: row.reference, status: row.status },
      );
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    view.applySearch();
  }

  const filtered = view.status !== 'all';
  const searched = view.applied !== '';

  return (
    <StaffPage busy={list.isPending}>
      <h1 className={type.h1}>{staffCopy.list.title}</h1>

      <WeekCount />

      <section aria-label="Filter and search" className="grid gap-sm sm:flex sm:items-center sm:justify-between sm:gap-md">
        <div
          role="group"
          aria-label={staffCopy.list.filterGroup}
          className="flex overflow-hidden rounded-md border border-border-strong bg-surface sm:w-80 sm:shrink-0"
        >
          {filters.map((filter) => {
            const active = view.status === filter;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={active}
                onClick={() => view.setStatus(filter)}
                className={cn(
                  'min-h-11 flex-1 cursor-pointer border-l border-border px-sm whitespace-nowrap first:border-l-0',
                  type.label,
                  focusRing,
                  'focus-visible:-outline-offset-3',
                  active ? 'bg-primary text-on-primary focus-visible:outline-focus-on-dark' : 'bg-surface text-text hover:bg-surface-raised',
                )}
              >
                {filterLabel(filter)}
              </button>
            );
          })}
        </div>
        <form role="search" aria-label={staffCopy.list.searchRegion} onSubmit={submitSearch} className="flex min-w-0 items-center gap-sm sm:max-w-112 sm:flex-1">
          <label htmlFor="request-search" className="sr-only">
            {staffCopy.list.searchLabel}
          </label>
          <input
            id="request-search"
            type="text"
            inputMode="search"
            autoComplete="off"
            maxLength={100}
            placeholder={staffCopy.list.searchPlaceholder}
            value={view.search}
            onChange={(event) => view.setSearch(event.target.value)}
            className={cn(
              'min-h-12 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-body text-text placeholder:text-text-secondary',
              focusRing,
            )}
          />
          <Button type="submit">{staffCopy.list.searchButton}</Button>
        </form>
      </section>

      <p role="status" className="sr-only">
        {list.isPending ? staffCopy.list.loading : moved}
      </p>

      <section aria-labelledby="list-heading" className="grid gap-md">
        <h2 id="list-heading" className="sr-only">
          {staffCopy.list.listHeading}
        </h2>

        {failure?.kind === 'save' ? (
          <Banner ref={failureBanner} variant="error" titleId="list-failure" title={staffCopy.list.saveFailed}>
            <p>{staffCopy.list.saveFailedBody(failure.reference, statusLabel[failure.status])}</p>
          </Banner>
        ) : failure?.kind === 'stale' ? (
          <Banner ref={failureBanner} variant="warning" titleId="list-failure" title={staffCopy.list.stale}>
            <Button
              onClick={() => {
                setFailure(null);
                void list.refetch();
              }}
            >
              <Icon name="refresh" className="size-4" />
              {staffCopy.list.reload}
            </Button>
          </Banner>
        ) : null}

        {list.isPending ? (
          <ListSkeleton />
        ) : list.isError ? (
          <Banner variant="error" titleId="list-error" title={staffCopy.list.loadFailed}>
            <p>{staffCopy.list.loadFailedBody}</p>
            <Button onClick={() => void list.refetch()} paused={list.isFetching}>
              <Icon name="refresh" className="size-4" />
              {staffCopy.list.retry}
            </Button>
          </Banner>
        ) : rows.length === 0 ? (
          <EmptyState filtered={filtered} searched={searched} status={view.status} onShowAll={view.reset} />
        ) : (
          <>
            <div
              className="rounded-lg border border-border bg-surface"
              onClickCapture={() => {
                rememberScroll(window.scrollY); // "Back to Requests" returns here
              }}
            >
              <RowHead />
              <ul>
                {rows.map((row) => (
                  <RequestRow key={row.id} row={row} href={`/requests/${row.id}`} saving={saving.has(row.id)} onMove={(to) => void move(row, to)} />
                ))}
              </ul>
            </div>
            {list.hasNextPage ? (
              <div className="grid justify-items-center">
                <Button onClick={() => void list.fetchNextPage()} paused={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? staffCopy.list.loadingMore : staffCopy.list.showMore}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </StaffPage>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-lg border border-border bg-surface">
      <ul>
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className={cn(rowGrid, 'border-t border-border p-md first:border-t-0')}>
            <Skeleton size="block" className="order-1 w-32 lg:order-none lg:col-span-2" />
            <Skeleton className="order-3 col-span-2 w-48 lg:order-none lg:col-span-3" />
            <Skeleton className="order-4 w-20 lg:order-none lg:col-span-2" />
            <Skeleton size="block" pill className="order-2 w-24 justify-self-end lg:order-none lg:col-span-2 lg:justify-self-start" />
            <Skeleton className="order-5 w-28 justify-self-end lg:order-none lg:col-span-3 lg:justify-self-start" />
            <Skeleton size="block" className="order-6 col-span-2 lg:order-none lg:col-span-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ filtered, searched, status, onShowAll }: { filtered: boolean; searched: boolean; status: StatusFilter; onShowAll: () => void }) {
  const base = 'grid justify-items-center gap-md rounded-lg border border-dashed border-border-strong bg-surface px-md py-2xl text-center';
  if (!filtered && !searched) {
    return (
      <div className={base}>
        <Icon name="inbox" className="size-8 text-text-secondary" />
        <h3 className={type.h2}>{staffCopy.list.emptyTitle}</h3>
        <p className="max-w-80 text-text-secondary">{staffCopy.list.emptyBody}</p>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex min-h-11 items-center gap-sm rounded-md border border-border-strong bg-surface px-md text-text hover:bg-surface-raised',
            type.label,
            focusRing,
          )}
        >
          {staffCopy.list.emptyAction}
          <Icon name="external" className="size-4" />
        </a>
      </div>
    );
  }
  const icon: IconName = status === 'lost' && !searched ? 'x-circle' : 'inbox';
  const title = searched || status === 'all' ? staffCopy.list.emptySearch : staffCopy.list.emptyFilter(statusLabel[status]);
  return (
    <div className={base}>
      <Icon name={icon} className="size-8 text-text-secondary" />
      <h3 className={type.h2}>{title}</h3>
      <Button onClick={onShowAll}>{staffCopy.list.showAll}</Button>
    </div>
  );
}
