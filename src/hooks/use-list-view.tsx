'use client';

// The Requests tab's view state: the status filter, the search text and the scroll position. They are client state,
// not part of the address (so the search text never reaches page-URL logs, docs/architecture.md "Routes and screens"),
// and they live in a provider the staff layout mounts, which stays mounted while she opens a request and comes back:
// "Back to Requests" finds the filter, the search and the scroll exactly as she left them (user-flows "Navigation").
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Cell } from '@/hooks/cell';
import type { Status } from '@/lib/api/generated/model';

export type StatusFilter = Status | 'all';

export interface ListView {
  status: StatusFilter;
  /** What is typed in the search box. */
  search: string;
  /** The search that is applied to the list (set when she presses Search). Empty = no search. */
  applied: string;
  setStatus: (status: StatusFilter) => void;
  setSearch: (search: string) => void;
  applySearch: () => void;
  /** Back to All with no search ("Show all requests"). */
  reset: () => void;
  /** Remember the page scroll position as she leaves the list for a request. Re-renders nothing. */
  rememberScroll: (y: number) => void;
  /** The remembered position, once: it is forgotten as it is handed back. 0 when she did not come back from a request. */
  takeScroll: () => number;
}

const ListViewContext = createContext<ListView | null>(null);

export function ListViewProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [scroll] = useState(() => new Cell(0));

  const rememberScroll = useCallback((y: number) => scroll.set(y), [scroll]);
  const takeScroll = useCallback(() => {
    const y = scroll.get();
    scroll.set(0);
    return y;
  }, [scroll]);
  const applySearch = useCallback(() => setApplied(search.trim()), [search]);
  const reset = useCallback(() => {
    setStatus('all');
    setSearch('');
    setApplied('');
  }, []);

  const value = useMemo<ListView>(
    () => ({ status, search, applied, setStatus, setSearch, applySearch, reset, rememberScroll, takeScroll }),
    [status, search, applied, applySearch, reset, rememberScroll, takeScroll],
  );
  return <ListViewContext value={value}>{children}</ListViewContext>;
}

export function useListView(): ListView {
  const value = useContext(ListViewContext);
  if (!value) throw new Error('useListView must be used inside ListViewProvider');
  return value;
}
