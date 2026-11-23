// User-facing words for SCR-05 (the Pipeline tab), in one place, as written in docs/design-specs.md "Copy" and the
// SCR-05 mockups. The status names, the "Move to" button and the failure banners of the Requests tab live in
// src/components/staff/copy.ts and are reused as they are; this file only adds what is the board's own.
import type { Status } from '@/lib/api/generated/model';

export const columnOrder: readonly Status[] = ['new', 'quoted', 'won', 'lost'];

export const pipelineCopy = {
  title: 'Pipeline',
  about:
    'Every request, by status. Drag a card to another column, or use its Move to button. Press Escape to cancel a drag. To filter or search, use the Requests tab.',
  jump: 'Jump to a column',
  board: 'Pipeline',
  loading: 'Loading the board',
  columnLoading: (name: string) => `${name}, loading`,
  empty: { new: 'No new requests', quoted: 'No quoted requests', won: 'No won requests', lost: 'No lost requests' } satisfies Record<Status, string>,
  dragging: 'Dragging',
  saving: 'Saving',
  release: (status: string) => `Release to move to ${status}`,
  showMore: 'Show more',
  loadingMore: 'Loading more',
  loadFailed: "Couldn't load requests. Try again.",
  loadFailedBody:
    'No columns are shown, so an empty column is never mistaken for "no requests". The weekly count above still loads on its own, and the Requests tab is still one tap away.',
  retry: 'Try again',
  saveFailed: "Couldn't save. Try again.",
  saveFailedBody: (reference: string, status: string) => `${reference} is still in ${status}. Nothing was changed and the weekly count is the same.`,
  stale: 'This request was changed by someone else. Reload to see the latest.',
  staleBody: (reference: string) => `${reference} stays as the other person left it. Your move was not saved.`,
  reload: 'Reload',
  moved: (reference: string, status: string) => `${reference} moved to ${status}`,
} as const;
