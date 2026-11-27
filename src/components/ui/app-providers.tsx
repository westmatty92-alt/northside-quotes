'use client';

// The client-side providers for the public pages: TanStack Query for the generated hooks, and the mock wrapper
// (transparent unless API mocking is on). Mutations are never retried automatically: a send must be one request.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { MockProvider } from '@/mocks/mock-provider';

export function AppProviders({ mocking, children }: { mocking: boolean; children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 }, mutations: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MockProvider enabled={mocking}>{children}</MockProvider>
    </QueryClientProvider>
  );
}
