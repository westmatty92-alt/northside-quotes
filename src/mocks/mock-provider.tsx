'use client';

// Wraps the app. With mocking off it is transparent and no mock code is loaded. With mocking on it holds the page
// back until the mock service worker is running (and any scenario seed is in place), then renders it, handing the
// form its seed through the preview context.
import { useEffect, useState, type ReactNode } from 'react';
import { FormPreviewContext, type FormPreview } from '@/components/request/preview-context';

interface MockProviderProps {
  /** Decided on the server (src/mocks/flag.ts) and passed down. */
  enabled: boolean;
  children: ReactNode;
}

type Boot = { ready: false } | { ready: true; preview: FormPreview | undefined };

export function MockProvider({ enabled, children }: MockProviderProps) {
  const [boot, setBoot] = useState<Boot>({ ready: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    import('@/mocks/browser')
      .then((mocks) => mocks.startMocking())
      .then((preview) => {
        if (!cancelled) setBoot({ ready: true, preview });
      })
      .catch((error: unknown) => {
        console.warn('API mocking could not start; the pages run without it.', error);
        if (!cancelled) setBoot({ ready: true, preview: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  if (!boot.ready) return null;
  return <FormPreviewContext value={boot.preview}>{children}</FormPreviewContext>;
}
