'use client';

// The Photos card of SCR-06 (thumbnails) and the SCR-08 viewer it opens.
//
// URLs. The request's photos arrive with short-lived signed URLs (900 seconds, `expires_at`). This card keeps them
// working for as long as the staff session lasts (AC-012.3): it asks `listQuoteRequestPhotos` for fresh ones when the
// viewer opens, 60 seconds before the earliest one expires, and whenever an image fails to load. A photo whose URL
// could not be signed (`url: null`) is "Photo unavailable", and so is every slot when Storage is down; the rest of the
// request is still shown.
import { useEffect, useRef, useState } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { PhotoViewer } from '@/components/staff/photo-viewer';
import { useFreshPhotos } from '@/components/staff/queries';
import { Icon } from '@/components/ui/icon';
import { focusRing } from '@/components/ui/button';
import { type } from '@/components/ui/typography';
import type { Photo } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

const REFRESH_BEFORE_MS = 60_000;
const MIN_REFRESH_GAP_MS = 5_000;

/** The soonest `expires_at` of the set, as a time; Infinity when none of them expires (or there are none). */
function earliestExpiry(photos: readonly Photo[]): number {
  return photos.reduce((min, photo) => (photo.expires_at ? Math.min(min, Date.parse(photo.expires_at)) : min), Infinity);
}

/** How long to wait before asking for fresh URLs: until 60 seconds before the earliest expiry, never under 5 seconds. */
export function refreshDelay(earliest: number, now: number): number | null {
  if (!Number.isFinite(earliest)) return null;
  return Math.max(MIN_REFRESH_GAP_MS, earliest - REFRESH_BEFORE_MS - now);
}

interface PhotoGalleryProps {
  requestId: string;
  reference: string;
  name: string;
  /** The photos the request came with. */
  photos: readonly Photo[];
}

export function PhotoGallery({ requestId, reference, name, photos: initial }: PhotoGalleryProps) {
  const [viewing, setViewing] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const fresh = useFreshPhotos(requestId, viewing !== null);
  // whichever set of signed URLs was issued later (the request itself reloads too, and brings its own)
  const refreshed: readonly Photo[] | undefined = fresh.data?.data;
  const photos: readonly Photo[] = refreshed && earliestExpiry(refreshed) >= earliestExpiry(initial) ? refreshed : initial;
  const refetch = fresh.refetch;

  // 60 seconds before the earliest URL expires, ask for new ones (never more often than every 5 seconds).
  const earliest = earliestExpiry(photos);
  useEffect(() => {
    const wait = refreshDelay(earliest, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(() => void refetch(), wait);
    return () => window.clearTimeout(timer);
  }, [earliest, refetch]);

  // An image that failed to load asks for fresh URLs once per set of URLs.
  const asked = useRef('');
  function onThumbError() {
    const signature = photos.map((photo) => photo.url ?? '').join('|');
    if (asked.current === signature) return;
    asked.current = signature;
    void refetch();
  }

  const total = photos.length;
  return (
    <>
      <section aria-labelledby="photos-heading" className="grid gap-md rounded-lg bg-surface-raised p-md">
        <h2 id="photos-heading" className={type.h2}>
          {staffCopy.detail.photos}
          {total > 0 ? <span className={cn(type.regular, 'text-text-secondary')}> ({total})</span> : null}
        </h2>

        {total === 0 ? (
          <div className="grid justify-items-center gap-sm rounded-lg border border-dashed border-border-strong bg-surface px-md py-xl text-center">
            <Icon name="camera" className="size-8 text-text-secondary" />
            <p>
              <span className={type.label}>{staffCopy.detail.noPhotos}</span>
              <br />
              <span className="text-text-secondary">{staffCopy.detail.noPhotosBody}</span>
            </p>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-sm">
              {photos.map((photo, index) => (
                <li key={photo.position} className="grid min-w-0">
                  {photo.url ? (
                    <button
                      type="button"
                      aria-label={staffCopy.detail.viewPhotoLabel(photo.position, total)}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setViewing(index);
                      }}
                      className={cn(
                        'relative aspect-4/3 min-h-11 cursor-pointer overflow-hidden rounded-md border border-border-strong bg-neutral-surface p-0',
                        focusRing,
                      )}
                    >
                      {/* SEC-16: a plain <img> on the signed URL, never next/image */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt=""
                        referrerPolicy="no-referrer"
                        decoding="async"
                        onError={onThumbError}
                        className="size-full object-cover"
                      />
                      <span
                        aria-hidden="true"
                        className={cn('absolute bottom-xs left-xs rounded-sm bg-surface-deep px-sm py-xs text-text-inverse', type.labelSm)}
                      >
                        {staffCopy.detail.viewPhoto(photo.position)}
                      </span>
                    </button>
                  ) : (
                    <div className="grid aspect-4/3 min-h-11 content-center justify-items-center gap-xs rounded-md border border-dashed border-border-strong bg-surface-raised p-xs text-center text-body-sm">
                      <Icon name="image" className="size-5" />
                      <span className={type.label}>{staffCopy.detail.photoUnavailable}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className={type.hint}>
              {photos.some((photo) => photo.url === null) ? staffCopy.detail.photosUnavailableHint : staffCopy.detail.photosHint}
            </p>
          </>
        )}
      </section>

      {viewing !== null ? (
        <PhotoViewer
          reference={reference}
          name={name}
          photos={photos}
          index={Math.min(viewing, total - 1)}
          onIndexChange={setViewing}
          onClose={() => {
            setViewing(null);
            opener.current?.focus(); // back on the thumbnail that opened it
          }}
          onRefresh={() => void refetch()}
        />
      ) : null}
    </>
  );
}
