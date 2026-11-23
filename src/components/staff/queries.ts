// The staff screens' reads and writes: thin wrappers over the GENERATED hooks and fetchers (never hand-written fetch).
// Each one passes the staff bearer token (`useStaffRequest`) and checks the answer against the generated Zod schema in
// `select`, so a body that breaks the contract shows the screen's "can't load" state instead of crashing.
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import type { ListQuoteRequestsParams, QuoteRequestDetail, QuoteRequestSummary, StaffMember, WeeklyCount, PhotoList } from '@/lib/api/generated/model';
import { getListQuoteRequestsQueryKey, listQuoteRequests, useGetQuoteRequest, useListQuoteRequestPhotos } from '@/lib/api/generated/inbox/inbox';
import {
  GetQuoteRequestResponse,
  ListQuoteRequestPhotosResponse,
  ListQuoteRequestsResponse,
} from '@/lib/api/generated/inbox/inbox.zod';
import { GetCurrentStaffResponse } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { useGetCurrentStaff } from '@/lib/api/generated/staff-auth/staff-auth';
import { GetCurrentWeeklyCountResponse } from '@/lib/api/generated/weekly-count/weekly-count.zod';
import { useGetCurrentWeeklyCount } from '@/lib/api/generated/weekly-count/weekly-count';
import { useStaffRequest } from '@/hooks/use-staff-request';

/** One generated response `{ data, status, headers }` checked against the operation's schema. */
function parseBody<T>(schema: ZodType<T>, response: { data: unknown }): T {
  return schema.parse(response.data);
}

const selectStaff = (response: { data: unknown }): StaffMember => parseBody(GetCurrentStaffResponse, response);
const selectWeek = (response: { data: unknown }): WeeklyCount => parseBody(GetCurrentWeeklyCountResponse, response);
const selectDetail = (response: { data: unknown }): QuoteRequestDetail => parseBody(GetQuoteRequestResponse, response);
const selectPhotos = (response: { data: unknown }): PhotoList => parseBody(ListQuoteRequestPhotosResponse, response);

/** Who is signed in ("Signed in as Owner"). */
export function useStaffMe() {
  const request = useStaffRequest();
  return useGetCurrentStaff({ query: { select: selectStaff, staleTime: 5 * 60_000 }, request });
}

/** SCR-07's three numbers. Invalidate `getGetCurrentWeeklyCountQueryKey()` after a status change to refresh it. */
export function useWeeklyCount() {
  const request = useStaffRequest();
  return useGetCurrentWeeklyCount({ query: { select: selectWeek, staleTime: 15_000 }, request });
}

/** One request in full (SCR-06). */
export function useRequestDetail(requestId: string) {
  const request = useStaffRequest();
  return useGetQuoteRequest(requestId, { query: { select: selectDetail, staleTime: 0 }, request });
}

/** Fresh signed photo URLs (SCR-08). Off until it is wanted. */
export function useFreshPhotos(requestId: string, enabled: boolean) {
  const request = useStaffRequest();
  return useListQuoteRequestPhotos(requestId, { query: { select: selectPhotos, enabled, staleTime: 0 }, request });
}

export const PAGE_SIZE = 50;

/** The key prefix every list query shares (the Requests tab, and each Pipeline column): invalidate it after a status change. */
export const listQueryPrefix = getListQuoteRequestsQueryKey();

export interface RequestListFilter {
  status?: ListQuoteRequestsParams['status'];
  q?: string;
}

/** The Requests tab's list: newest first, 50 at a time, "Show more" asks for the next cursor (FR-10). */
export function useRequestList(filter: RequestListFilter) {
  const request = useStaffRequest();
  const params: ListQuoteRequestsParams = { limit: PAGE_SIZE, ...(filter.status ? { status: filter.status } : {}), ...(filter.q ? { q: filter.q } : {}) };
  return useInfiniteQuery({
    queryKey: [...getListQuoteRequestsQueryKey(params), 'pages'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await listQuoteRequests({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal, ...request });
      return parseBody(ListQuoteRequestsResponse, response);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    select: (data) => ({ rows: data.pages.flatMap((page): QuoteRequestSummary[] => page.data) }),
  });
}
