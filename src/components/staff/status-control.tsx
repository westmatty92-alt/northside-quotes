'use client';

// "Status" on SCR-06: a four-part control. Choosing one saves at once, and the control is paused (the chosen status
// showing a busy icon) until it finishes. Choosing the status that is already selected does nothing and says nothing.
// Any status can go to any other (Won to Lost included). Saving a price never changes the status, and this card says so.
//
// A failed save keeps the previous status and says "Couldn't save. Try again." Someone else changed the request first
// (409 stale_version): the parent shows the "changed by someone else" notice. A session that ended is the query
// client's: it signs out and goes to SCR-03.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { staffCopy, statusLabel, statusOrder } from '@/components/staff/copy';
import { listQueryPrefix } from '@/components/staff/queries';
import { Banner } from '@/components/ui/banner';
import { focusRing } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { isApiProblem } from '@/lib/api/fetcher';
import { getGetQuoteRequestQueryKey, useChangeQuoteRequestStatus } from '@/lib/api/generated/inbox/inbox';
import { ChangeQuoteRequestStatusResponse } from '@/lib/api/generated/inbox/inbox.zod';
import type { QuoteRequestDetail, Status } from '@/lib/api/generated/model';
import { getGetCurrentWeeklyCountQueryKey } from '@/lib/api/generated/weekly-count/weekly-count';
import { cn } from '@/lib/utils';

const words = staffCopy.detail;

interface StatusControlProps {
  requestId: string;
  status: Status;
  version: number;
  onConflict: () => void;
}

export function StatusControl({ requestId, status, version, onConflict }: StatusControlProps) {
  const request = useStaffRequest();
  const queryClient = useQueryClient();
  const change = useChangeQuoteRequestStatus({ request });
  const [choosing, setChoosing] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = choosing !== null;

  async function choose(to: Status) {
    if (busy || to === status) return; // the same status again changes nothing
    setFailed(false);
    setChoosing(to);
    try {
      const response = await change.mutateAsync({ requestId, data: { to_status: to, version } });
      const result = ChangeQuoteRequestStatusResponse.parse(response.data);
      // show the new status at once; the request is read again for the GoHighLevel line and "last updated"
      queryClient.setQueryData<{ data: QuoteRequestDetail } | undefined>(getGetQuoteRequestQueryKey(requestId), (old) =>
        old && { ...old, data: { ...old.data, status: result.status, status_changed_at: result.status_changed_at, version: result.version } },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetQuoteRequestQueryKey(requestId) }),
        queryClient.invalidateQueries({ queryKey: getGetCurrentWeeklyCountQueryKey() }),
        queryClient.invalidateQueries({ queryKey: listQueryPrefix }),
      ]);
    } catch (error) {
      if (isApiProblem(error) && error.status === 401) return; // the session ended: the mutation cache takes her to SCR-03
      if (isApiProblem(error) && error.code === 'stale_version') onConflict();
      else setFailed(true);
    } finally {
      setChoosing(null);
    }
  }

  return (
    <section aria-labelledby="status-heading" className="grid gap-md rounded-lg bg-surface-raised p-md">
      <h2 id="status-heading" className={type.h2}>
        {words.status}
      </h2>

      {failed ? (
        <Banner variant="error" titleId="status-failed" title={words.statusFailed}>
          <p>{words.statusFailedBody(statusLabel[status])}</p>
        </Banner>
      ) : null}

      <div role="group" aria-labelledby="status-heading" className="flex overflow-hidden rounded-md border border-border-strong bg-surface">
        {statusOrder.map((option) => {
          const showing = choosing ?? status; // while a save runs, the chosen status is the one marked
          const marked = option === showing;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={marked}
              aria-disabled={busy || undefined}
              onClick={() => void choose(option)}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-center gap-xs border-l border-border px-sm whitespace-nowrap first:border-l-0',
                type.label,
                focusRing,
                'focus-visible:-outline-offset-3',
                busy ? 'cursor-not-allowed' : 'cursor-pointer',
                marked ? 'bg-primary text-on-primary focus-visible:outline-focus-on-dark' : cn('bg-surface text-text', !busy && 'hover:bg-surface-raised'),
              )}
            >
              {marked ? <Icon name={busy && choosing === option ? 'refresh' : 'tick'} className="size-4" /> : null}
              {statusLabel[option]}
            </button>
          );
        })}
      </div>
      <p className={type.hint}>{words.statusHint}</p>
    </section>
  );
}
