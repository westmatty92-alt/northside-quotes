'use client';

// Wraps the app. With mocking off it is transparent and no mock code is loaded. With mocking on it holds the page
// back until the mock network is running (and any scenario seed is in place), then renders it, handing the request
// form and the sign-in form their seeds through their preview contexts.
import { useEffect, useState, type ReactNode } from 'react';
import { FormPreviewContext } from '@/components/request/preview-context';
import { PipelinePreviewContext } from '@/components/staff/pipeline/pipeline-preview';
import { SignInPreviewContext } from '@/components/staff/sign-in-preview';
import type { MockSeeds } from '@/mocks/browser';

interface MockProviderProps {
  /** Decided on the server (src/mocks/flag.ts) and passed down. */
  enabled: boolean;
  children: ReactNode;
}

type Boot = { ready: false } | { ready: true; seeds: MockSeeds | undefined };

export function MockProvider({ enabled, children }: MockProviderProps) {
  const [boot, setBoot] = useState<Boot>({ ready: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    import('@/mocks/browser')
      .then((mocks) => mocks.startMocking())
      .then((seeds) => {
        if (!cancelled) setBoot({ ready: true, seeds });
      })
      .catch((error: unknown) => {
        console.warn('API mocking could not start; the pages run without it.', error);
        if (!cancelled) setBoot({ ready: true, seeds: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  if (!boot.ready) return null;
  return (
    <FormPreviewContext value={boot.seeds?.form}>
      <SignInPreviewContext value={boot.seeds?.signIn}>
        <PipelinePreviewContext value={boot.seeds?.pipeline}>{children}</PipelinePreviewContext>
      </SignInPreviewContext>
    </FormPreviewContext>
  );
}
