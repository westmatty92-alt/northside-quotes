'use client';

// The GoHighLevel card of SCR-06 (SyncState in the component map): two lines, each an icon and words (never colour
// alone): CONTACT COPY (copied with the time, waiting to retry, failed with the time of the last try and a "Retry copy"
// button) and STAGE TAG (up to date, waiting to retry, failed with the time of the last try). No token or technical
// detail is ever shown.
//
// A request whose homeowner did NOT tick the offers box (`ghl.copy.state` is `not_copied_no_consent`, `stage_tag` is
// null) shows ONE line instead: "Not copied: no offers consent", with a sentence that nothing is sent. No Retry button
// (not even a paused one), no stage tag line, in any status (AC-010.6, AC-014.4, AC-017.16).
//
// "Retry copy" is the Could story US-014, one self-contained button: while the try runs it reads "Retrying" and is
// paused, so a double click makes one try; "The retry did not work." says so and the state stays failed.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { formatSubmitted } from '@/components/staff/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { isApiProblem } from '@/lib/api/fetcher';
import { getGetQuoteRequestQueryKey } from '@/lib/api/generated/inbox/inbox';
import { useRetryGhlCopy } from '@/lib/api/generated/go-high-level/go-high-level';
import { RetryGhlCopyResponse } from '@/lib/api/generated/go-high-level/go-high-level.zod';
import type { GhlState } from '@/lib/api/generated/model';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const words = staffCopy.detail;

interface Line {
  icon: IconName;
  tone: string;
  text: string;
  /** The time, shown quietly beside the words. */
  when?: string;
  hint?: string;
}

function copyLine(copy: GhlState['copy']): Line {
  switch (copy.state) {
    case 'copied':
      return { icon: 'check-circle', tone: 'text-success', text: words.copied, ...(copy.at ? { when: formatSubmitted(copy.at) } : {}) };
    case 'waiting':
      return { icon: 'clock', tone: 'text-warning', text: words.copyWaiting, hint: words.copyWaitingHint };
    case 'failed':
      return {
        icon: 'alert',
        tone: 'text-danger',
        text: words.copyFailed,
        ...(copy.at ? { when: words.lastTried(formatSubmitted(copy.at)) } : {}),
        hint: words.copyFailedHint,
      };
    case 'not_copied_no_consent':
      return { icon: 'info', tone: 'text-primary', text: words.noConsent };
  }
}

function tagLine(tag: NonNullable<GhlState['stage_tag']>): Line {
  switch (tag.state) {
    case 'up_to_date':
      return { icon: 'check-circle', tone: 'text-success', text: words.tagUpToDate };
    case 'waiting':
      return { icon: 'clock', tone: 'text-warning', text: words.tagWaiting };
    case 'failed':
      return {
        icon: 'alert',
        tone: 'text-danger',
        text: words.tagFailed,
        ...(tag.at ? { when: words.lastTried(formatSubmitted(tag.at)) } : {}),
        hint: words.tagFailedHint,
      };
  }
}

function State({ line }: { line: Line }) {
  return (
    <p className={cn('flex items-start gap-sm', type.label)}>
      <Icon name={line.icon} className={cn('mt-xs size-5', line.tone)} />
      <span>
        {line.text}
        {line.when ? <span className={cn(type.regular, 'text-text-secondary')}> {line.when}</span> : null}
      </span>
    </p>
  );
}

const rowLabel = cn(type.labelSm, 'text-text-secondary');

export function GhlCard({ requestId, ghl }: { requestId: string; ghl: GhlState }) {
  const request = useStaffRequest();
  const queryClient = useQueryClient();
  const retry = useRetryGhlCopy({ request });
  const [outcome, setOutcome] = useState<'did-not-work' | 'unavailable' | null>(null);

  const noConsent = ghl.copy.state === 'not_copied_no_consent';
  const copy = copyLine(ghl.copy);
  const tag = ghl.stage_tag ? tagLine(ghl.stage_tag) : null;
  const retrying = retry.isPending;

  async function retryCopy() {
    if (retrying) return;
    setOutcome(null);
    try {
      const response = await retry.mutateAsync({ requestId });
      const result = RetryGhlCopyResponse.parse(response.data);
      if (result.copy.state !== 'copied') setOutcome('did-not-work');
    } catch (error) {
      if (isApiProblem(error) && error.status === 401) return; // the session ended: the mutation cache takes her to SCR-03
      setOutcome(isApiProblem(error) && error.code === 'not_retryable' ? 'unavailable' : 'did-not-work');
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetQuoteRequestQueryKey(requestId) });
    }
  }

  return (
    <section aria-labelledby="ghl-heading" className="grid gap-md rounded-lg bg-surface-raised p-md">
      <h2 id="ghl-heading" className={type.h2}>
        {words.ghl}
      </h2>

      {noConsent ? (
        <div className="grid gap-xs">
          <State line={copy} />
          <p className={type.hint}>{words.noConsentBody}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-xs">
            <p className={rowLabel}>{words.ghlCopyLabel}</p>
            <State line={copy} />
            {copy.hint ? <p className={type.hint}>{copy.hint}</p> : null}
            {ghl.copy.state === 'failed' ? (
              <div>
                <Button paused={retrying} onClick={() => void retryCopy()}>
                  <Icon name="refresh" className="size-4" />
                  {retrying ? words.retrying : words.retryCopy}
                </Button>
              </div>
            ) : null}
            {outcome === 'did-not-work' ? (
              <Banner variant="error" titleId="retry-outcome" title={words.retryFailed}>
                <p>{words.retryFailedBody}</p>
              </Banner>
            ) : outcome === 'unavailable' ? (
              <Banner variant="warning" titleId="retry-outcome" title={words.retryUnavailable}>
                <p>{words.retryUnavailableBody}</p>
              </Banner>
            ) : null}
          </div>
          {tag ? (
            <div className="grid gap-xs">
              <p className={rowLabel}>{words.ghlTagLabel}</p>
              <State line={tag} />
              {tag.hint ? <p className={type.hint}>{tag.hint}</p> : null}
            </div>
          ) : null}
          <p className={type.hint}>{words.ghlHint}</p>
        </>
      )}
    </section>
  );
}
