// Shared helpers for the staff screens' component tests (not a test file itself). The screens run exactly as in the app:
// the real staff query client (its 401 handling included), the real session and list-view providers, and the mock API
// of src/mocks/staff-handlers.ts answering through msw; only the router and full-page navigation are stand-ins.
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { createStaffQueryClient } from '@/components/staff/staff-query-client';
import { StaffSessionProvider } from '@/components/staff/staff-session';
import { ListViewProvider } from '@/hooks/use-list-view';

export { expectNoAxeViolations } from '@/components/request/test-support';

export interface StaffRender {
  queryClient: QueryClient;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
  container: HTMLElement;
}

/** Render inside the staff providers. `mocking` is the session's mock mode (no bearer token, no Supabase). */
export function renderStaff(ui: ReactElement, { mocking = true }: { mocking?: boolean } = {}): StaffRender {
  let endSession: () => Promise<void> = () => Promise.resolve();
  const queryClient = createStaffQueryClient(() => void endSession());
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } }); // errors show at once
  const wrap = (element: ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <StaffSessionProvider
        mocking={mocking}
        registerEndSession={(fn) => {
          endSession = fn;
        }}
      >
        <ListViewProvider>{element}</ListViewProvider>
      </StaffSessionProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { queryClient, container: view.container, unmount: view.unmount, rerender: (next) => view.rerender(wrap(next)) };
}

/**
 * WCAG 2.5.3 Label in Name (axe `label-content-name-mismatch`, tagged wcag21a: the tag verify-ui does not run and QA does).
 * axe skips this rule as "needs review" in jsdom: it has no layout (nothing counts as visible text) and no canvas (axe asks
 * one whether a word is an icon ligature). So, while axe runs, every element gets a box and a canvas stand-in answers
 * "not a ligature". Everything is put back afterwards.
 */
export async function expectLabelsContainVisibleText(container: Element) {
  const box = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) } as DOMRect;
  const canvasContext = {
    canvas: {},
    font: '',
    textAlign: '',
    textBaseline: '',
    measureText: (text: string) => ({ width: 10 * text.length }),
    fillText: () => undefined,
    clearRect: () => undefined,
    // every pixel is "inked", so a word drawn alone and in a sentence look the same: not a ligature
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(1, Math.floor(width * height)) * 4).fill(1),
    }),
  };
  const saved = {
    element: [Element.prototype.getBoundingClientRect, Element.prototype.getClientRects] as const,
    range: [Range.prototype.getBoundingClientRect, Range.prototype.getClientRects] as const,
    getContext: HTMLCanvasElement.prototype.getContext,
  };
  Element.prototype.getBoundingClientRect = () => box;
  Element.prototype.getClientRects = () => [box] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => box;
  Range.prototype.getClientRects = () => [box] as unknown as DOMRectList;
  HTMLCanvasElement.prototype.getContext = (() => canvasContext) as unknown as HTMLCanvasElement['getContext'];
  try {
    const results = await axe.run(container, { runOnly: { type: 'rule', values: ['label-content-name-mismatch'] } });
    const unresolved = results.incomplete.map((item) => `${item.id}: axe could not decide (${item.nodes.length} elements)`);
    const failed = results.violations.map(
      (violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.html.slice(0, 120)).join(' | ')}`,
    );
    const checked = results.passes.reduce((count, item) => count + item.nodes.length, 0);
    // a check that looked at nothing proves nothing
    expect(checked + results.violations.length, 'axe found no labelled control with visible text to check').toBeGreaterThan(0);
    expect([...failed, ...unresolved]).toEqual([]);
  } finally {
    [Element.prototype.getBoundingClientRect, Element.prototype.getClientRects] = saved.element;
    [Range.prototype.getBoundingClientRect, Range.prototype.getClientRects] = saved.range;
    HTMLCanvasElement.prototype.getContext = saved.getContext;
  }
}

/** jsdom has no <dialog> behaviour: showModal() and close() are stood in for (open attribute, then a `close` event). */
export function installDialogStandIn(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
