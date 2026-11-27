// The staff screens' TanStack Query client.
//   - Reads retry once, and never for an answer that will not change (401, 403, 404, 422). Mutations never retry: a
//     save or a status change is one request (fe-state).
//   - Any 401 from a staff call, read or write, hands over to `onSessionEnded` (sign out, then SCR-03; AC-004.7).
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiProblem } from '@/lib/api/fetcher';

const FINAL_STATUSES: readonly number[] = [401, 403, 404, 422];

export function createStaffQueryClient(onSessionEnded: () => void): QueryClient {
  const watch = (error: unknown) => {
    if (isApiProblem(error) && error.status === 401) onSessionEnded();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: watch }),
    mutationCache: new MutationCache({ onError: watch }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 1 && !(isApiProblem(error) && FINAL_STATUSES.includes(error.status)),
        retryDelay: 500,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
