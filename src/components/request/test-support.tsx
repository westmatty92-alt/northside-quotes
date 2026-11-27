// Shared helpers for the SCR-01 and SCR-02 component tests (not a test file itself).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (element: ReactElement) => <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>;
  const view = render(wrap(ui));
  return { ...view, rerender: (next: ReactElement) => view.rerender(wrap(next)) };
}

/** axe on the rendered state. Colour contrast and landmarks need a real layout and a whole page; verify-ui checks both. */
export async function expectNoAxeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

/** A file with the first bytes of a real JPEG, PNG or WebP (or something else), so the form's type check sees it. */
export function photoFile(name: string, kind: 'jpeg' | 'png' | 'webp' | 'pdf' = 'jpeg', bytes = 2048): File {
  const heads = {
    jpeg: [0xff, 0xd8, 0xff, 0xe0],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  } as const;
  const content = new Uint8Array(bytes);
  content.set(heads[kind]);
  const type = kind === 'pdf' ? 'application/pdf' : `image/${kind}`;
  return new File([content], name, { type });
}
