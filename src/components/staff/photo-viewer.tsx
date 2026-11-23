'use client';

// SCR-08 Photo viewer: one photo at full size, a dialog over SCR-06 on a full-screen ink background. It is a native
// <dialog> opened with showModal(), so the browser traps focus inside, makes the page behind inert, and Escape closes it.
// Focus starts on Close. Left and Right arrow keys, or the two buttons, move through the photos (no wrap-around: Previous
// is paused on the first and Next on the last). The title "Photo 2 of 3" is a polite live region, so every move is
// announced. Closing hands focus back to whatever opened it (the thumbnail), at the same scroll position.
//
// The photo is a plain <img src={signed URL}>: never next/image (SEC-16: Next's optimiser would fetch the signed URL
// server-side and cache a private photo). The URLs are short-lived; the caller keeps them fresh and passes new ones.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import type { Photo } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

interface PhotoViewerProps {
  reference: string;
  name: string;
  photos: readonly Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** "Try again" and a URL that failed to load: ask for fresh signed URLs. */
  onRefresh: () => void;
}

const onInk = 'focus-visible:outline-focus-on-dark';

export function PhotoViewer({ reference, name, photos, index, onIndexChange, onClose, onRefresh }: PhotoViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [outcome, setOutcome] = useState<{ key: string; state: 'loaded' | 'failed' } | null>(null);
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);

  // Open as a modal on mount; the page behind does not scroll while it is open.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    closeButton.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = overflow;
      if (element.open) element.close();
    };
  }, []);

  const photo = photos[index];
  const total = photos.length;
  const key = photo ? `${photo.position}|${photo.url ?? ''}` : '';
  const state = !photo?.url ? 'failed' : outcome?.key === key ? outcome.state : 'loading';

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      onIndexChange(index - 1);
    } else if (event.key === 'ArrowRight' && index < total - 1) {
      event.preventDefault();
      onIndexChange(index + 1);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="viewer-title"
      onKeyDown={onKeyDown}
      onClose={() => closing.current()}
      className="m-0 h-dvh max-h-none w-dvw max-w-none flex-col gap-md border-0 bg-surface-deep p-md text-text-inverse open:flex"
    >
      <div className="flex items-center justify-between gap-md">
        <div>
          <h2 id="viewer-title" aria-live="polite" className={cn('text-h3 font-h3 font-(weight:--font-weight-h3) leading-tight')}>
            {staffCopy.viewer.title(index + 1, total)}
          </h2>
          <p className={cn(type.hint, 'text-text-inverse')}>{staffCopy.viewer.meta(reference, name)}</p>
        </div>
        <Button ref={closeButton} onClick={() => dialog.current?.close()} className={cn('min-w-11 justify-center', onInk)}>
          <Icon name="x" className="size-4" />
          {staffCopy.viewer.close}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center">
        {photo?.url && state !== 'failed' ? (
          <figure className="relative aspect-4/3 w-full max-w-240 overflow-hidden rounded-md bg-neutral-surface">
            {/* SEC-16: a plain <img> on the signed URL, never next/image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={key}
              src={photo.url}
              alt={staffCopy.viewer.alt(index + 1, total, reference)}
              referrerPolicy="no-referrer"
              decoding="async"
              onLoad={() => setOutcome({ key, state: 'loaded' })}
              onError={() => {
                setOutcome({ key, state: 'failed' });
                onRefresh(); // a URL that fails may simply have expired: ask for fresh ones
              }}
              className={cn('size-full object-contain', state === 'loading' && 'invisible')}
            />
            {state === 'loading' ? (
              <div role="status" className="absolute inset-0 grid place-items-center text-text">
                {staffCopy.viewer.loading}
              </div>
            ) : null}
          </figure>
        ) : (
          <div
            role="alert"
            className="grid aspect-4/3 w-full max-w-240 content-center justify-items-center gap-sm rounded-md bg-surface-raised p-md text-center text-text"
          >
            <Icon name="alert" className="size-8 text-text-secondary" />
            <p className={type.label}>{staffCopy.viewer.unavailable}</p>
            <p className={type.hint}>{staffCopy.viewer.unavailableBody}</p>
            <Button
              onClick={() => {
                setOutcome(null);
                onRefresh();
              }}
            >
              <Icon name="refresh" className="size-4" />
              {staffCopy.viewer.retry}
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-md">
        <Button className={cn('max-w-60 flex-1', onInk)} paused={index <= 0} onClick={() => onIndexChange(index - 1)}>
          <Icon name="left" className="size-4" />
          {staffCopy.viewer.previous}
        </Button>
        <Button className={cn('max-w-60 flex-1', onInk)} paused={index >= total - 1} onClick={() => onIndexChange(index + 1)}>
          {staffCopy.viewer.next}
          <Icon name="right" className="size-4" />
        </Button>
      </div>
    </dialog>
  );
}
