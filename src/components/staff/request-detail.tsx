'use client';

// SCR-06 Request detail: read one request, record the price and note, set the status, and see whether the GoHighLevel
// copy worked. One screen under both tabs (/requests/[id] and /pipeline/[id]): the tab she came from stays marked and
// "Back to Requests" or "Back to Pipeline" returns to it, with the Requests tab's filter, search and scroll kept
// (use-list-view.tsx lives in the layout, so it is still there).
//
// Focal point: the job tag and name, then the one primary button, "Save price and note". From 1024 px two columns: the
// request and its photos on the left; the quote, status and GoHighLevel on the right. On a phone one column in that
// order, so she reads, then quotes.
//
// States: loading (a skeleton in the real two-column layout), the request cannot be loaded (with Try again), not found,
// success, and every state of the pieces: no photos, no price, "Not updated yet", photos unavailable, saved, could not
// save, changed by someone else, GoHighLevel waiting / failed / no consent. A session that ended sends her to SCR-03.
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { JobTag } from '@/components/request/job-tag';
import { UrgencyChip } from '@/components/request/urgency-chip';
import { staffCopy, urgencyDescription } from '@/components/staff/copy';
import { formatLastUpdated, formatPhone, formatSubmitted, telHref } from '@/components/staff/format';
import { GhlCard } from '@/components/staff/ghl-card';
import { PhotoGallery } from '@/components/staff/photo-gallery';
import { QuoteForm } from '@/components/staff/quote-form';
import { useRequestDetail } from '@/components/staff/queries';
import { StaffPage } from '@/components/staff/staff-page';
import { StatusBadge } from '@/components/staff/status-badge';
import { StatusControl } from '@/components/staff/status-control';
import { Banner } from '@/components/ui/banner';
import { Button, focusRing, linkButtonClass } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { type } from '@/components/ui/typography';
import { isApiProblem } from '@/lib/api/fetcher';
import { getGetQuoteRequestQueryKey } from '@/lib/api/generated/inbox/inbox';
import type { QuoteRequestDetail } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

const words = staffCopy.detail;
const card = 'grid gap-md rounded-lg bg-surface-raised p-md';
const columns = 'grid items-start gap-md lg:grid-cols-2';

interface RequestDetailProps {
  requestId: string;
  /** The tab she came from: the path decides (`/requests/...` or `/pipeline/...`). */
  tab: 'requests' | 'pipeline';
}

export function RequestDetail({ requestId, tab }: RequestDetailProps) {
  const detail = useRequestDetail(requestId);
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const tabName = tab === 'requests' ? 'Requests' : 'Pipeline';

  async function reload() {
    await queryClient.refetchQueries({ queryKey: getGetQuoteRequestQueryKey(requestId) });
    setConflict(false);
    setFormKey((key) => key + 1); // the form starts again from the request as it is now
  }

  const notFound = detail.isError && isApiProblem(detail.error) && detail.error.status === 404;

  return (
    <StaffPage busy={detail.isPending}>
      <div>
        {/* returning to the list keeps its scroll: the list restores it itself, so the page must not jump to the top first */}
        <Link
          href={`/${tab}`}
          scroll={tab !== 'requests'}
          className={cn('inline-flex min-h-11 items-center gap-xs text-primary underline underline-offset-4', type.label, focusRing)}
        >
          <Icon name="back" className="size-4" />
          {words.backTo(tabName)}
        </Link>
      </div>

      {detail.isPending ? (
        <DetailSkeleton />
      ) : notFound ? (
        <div className={cn(card, 'justify-items-start')}>
          <h1 className={type.h2}>{words.notFound}</h1>
          <p className="text-text-secondary">{words.notFoundBody}</p>
        </div>
      ) : detail.isError ? (
        <Banner variant="error" titleId="detail-error" title={words.loadFailed}>
          <Button onClick={() => void detail.refetch()} paused={detail.isFetching}>
            <Icon name="refresh" className="size-4" />
            {staffCopy.list.retry}
          </Button>
        </Banner>
      ) : (
        <Loaded requestId={requestId} request={detail.data} conflict={conflict} formKey={formKey} onConflict={() => setConflict(true)} onReload={reload} />
      )}
    </StaffPage>
  );
}

function Loaded({
  requestId,
  request,
  conflict,
  formKey,
  onConflict,
  onReload,
}: {
  requestId: string;
  request: QuoteRequestDetail;
  conflict: boolean;
  formKey: number;
  onConflict: () => void;
  onReload: () => Promise<void>;
}) {
  const [reloading, setReloading] = useState(false);
  const phone = formatPhone(request.phone);
  const firstName = request.name.split(' ')[0] ?? request.name;

  return (
    <>
      <header className="grid gap-md">
        <div>
          <JobTag reference={request.reference} variant="display" />
        </div>
        <h1 className={type.h1}>{request.name}</h1>
        <div className="flex flex-wrap items-center gap-x-md gap-y-sm">
          <StatusBadge status={request.status} />
          <UrgencyChip urgency={request.urgency} />
          <time dateTime={request.submitted_at} className={type.hint}>
            {words.submitted(formatSubmitted(request.submitted_at))}
          </time>
        </div>
      </header>

      <div className={columns}>
        <div className="grid gap-md">
          <section aria-labelledby="request-heading" className={card}>
            <h2 id="request-heading" className={type.h2}>
              {words.requestHeading}
            </h2>
            <div className="grid gap-sm sm:grid-cols-2">
              <a href={telHref(request.phone)} className={cn(linkButtonClass, 'w-full')}>
                <Icon name="phone" className="size-4" />
                {words.callLabel(phone)}
              </a>
              <a href={`mailto:${request.email}`} className={cn(linkButtonClass, 'w-full')}>
                <Icon name="mail" className="size-4" />
                {words.emailLabel(firstName)}
              </a>
            </div>
            <dl className="grid gap-md">
              <Fact term={words.phone}>
                <a href={telHref(request.phone)} className={cn('text-primary underline underline-offset-4', focusRing)}>
                  {phone}
                </a>
              </Fact>
              <Fact term={words.email}>
                <a href={`mailto:${request.email}`} className={cn('text-primary underline underline-offset-4', focusRing)}>
                  {request.email}
                </a>
              </Fact>
              <Fact term={words.address}>{request.address}</Fact>
              <Fact term={words.urgency}>
                <span className="flex flex-wrap items-center gap-sm">
                  <UrgencyChip urgency={request.urgency} />
                  <span className="text-text-secondary">{urgencyDescription[request.urgency]}</span>
                </span>
              </Fact>
              <Fact term={words.problem}>
                <span className="whitespace-pre-wrap">{request.problem}</span>
              </Fact>
            </dl>
          </section>

          <PhotoGallery requestId={requestId} reference={request.reference} name={request.name} photos={request.photos} />
        </div>

        <div className="grid gap-md">
          {conflict ? (
            <Banner variant="warning" titleId="conflict" title={words.stale}>
              <p>{words.staleBody}</p>
              <Button
                paused={reloading}
                onClick={() => {
                  setReloading(true);
                  void onReload().finally(() => setReloading(false));
                }}
              >
                <Icon name="refresh" className="size-4" />
                {words.reload}
              </Button>
            </Banner>
          ) : null}
          <QuoteForm key={formKey} requestId={requestId} detail={request} conflict={conflict} onConflict={onConflict} />
          <StatusControl requestId={requestId} status={request.status} version={request.version} onConflict={onConflict} />
          <GhlCard requestId={requestId} ghl={request.ghl} />
          <p className={type.hint}>
            {request.last_updated
              ? words.lastUpdated(request.last_updated.by_display_name, formatLastUpdated(request.last_updated.at))
              : words.notUpdated}
          </p>
        </div>
      </div>
    </>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-xs">
      <dt className={cn(type.labelSm, 'text-text-secondary')}>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The loading state in the real two-column layout, photo tiles included, so nothing jumps when the request arrives. */
function DetailSkeleton() {
  return (
    <>
      <p role="status" className="sr-only">
        {words.loading}
      </p>
      <header aria-hidden="true" className="grid gap-md">
        <Skeleton size="block" className="w-64" />
        <Skeleton size="block" className="w-48" />
        <Skeleton className="w-72" />
      </header>
      <div aria-hidden="true" className={columns}>
        <div className="grid gap-md">
          <div className={card}>
            <Skeleton size="block" className="w-1/2" />
            <Skeleton size="block" />
            <Skeleton className="w-3/4" />
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
          <div className={card}>
            <Skeleton size="block" className="w-1/3" />
            <div className="grid grid-cols-3 gap-sm">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="aspect-4/3 h-auto" />
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-md">
          <div className={card}>
            <Skeleton size="block" className="w-1/2" />
            <Skeleton size="block" />
            <Skeleton size="block" />
          </div>
        </div>
      </div>
    </>
  );
}
