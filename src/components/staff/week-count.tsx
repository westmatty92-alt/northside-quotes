'use client';

// SCR-07 Weekly count: three numbers for the current Monday-to-Sunday week in Hamilton time, a strip under the page
// title on both tabs (identical on each). It never changes with the Requests filter or search, loads on its own (the
// list or board below loads whether or not the count does, AC-008.8), and changes in place within 2 seconds of a status
// save: whoever saves invalidates `getGetCurrentWeeklyCountQueryKey()` and this strip fetches again.
//
// A number that changes is announced politely ("Won 2") through a live region that exists from the start, and its tile
// is outlined in green for a moment. The outline is extra: the number and the words carry the meaning.
import { useEffect, useRef, useState } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { formatWeekRange } from '@/components/staff/format';
import { useWeeklyCount } from '@/components/staff/queries';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const tile = 'grid content-start gap-xs rounded-lg bg-surface-raised p-md';
const number = 'font-display font-(weight:--font-weight-display) text-display leading-none';
const label = cn('flex items-center gap-xs text-body-sm', type.label);
const OUTLINE_MS = 2000;

type Changed = 'won' | 'lost' | null;

export function WeekCount() {
  const week = useWeeklyCount();
  const data = week.data;
  const last = useRef<{ won: number; lost: number } | null>(null);
  const [changed, setChanged] = useState<Changed>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!data) return;
    const before = last.current;
    last.current = { won: data.won, lost: data.lost };
    if (!before) return; // the first numbers are not news
    const next: Changed = data.won !== before.won ? 'won' : data.lost !== before.lost ? 'lost' : null;
    if (!next) return;
    setChanged(next);
    setAnnouncement(next === 'won' ? `${staffCopy.week.won} ${data.won}` : `${staffCopy.week.lost} ${data.lost}`);
    const timer = window.setTimeout(() => setChanged(null), OUTLINE_MS);
    return () => window.clearTimeout(timer);
  }, [data]);

  return (
    <section aria-labelledby="week-heading" className="grid gap-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-xs">
        <h2 id="week-heading" className={cn(type.labelSm, 'text-text-secondary')}>
          {staffCopy.week.label}
        </h2>
        {data ? <p className={type.hint}>{formatWeekRange(data.week_start, data.week_end)}</p> : null}
      </div>

      {week.isPending ? (
        <div aria-busy="true">
          <p role="status" className="sr-only">
            {staffCopy.week.loading}
          </p>
          <ul className="grid grid-cols-3 gap-sm">
            {[0, 1, 2].map((index) => (
              <li key={index} className={tile}>
                <Skeleton size="block" className="w-1/2" />
                <Skeleton className="w-full" />
              </li>
            ))}
          </ul>
        </div>
      ) : data ? (
        <>
          <ul className="grid grid-cols-3 gap-sm">
            <li className={tile}>
              <span className={number}>{data.requests}</span>
              <span className={label}>{staffCopy.week.requests}</span>
            </li>
            <li className={cn(tile, changed === 'won' && 'outline-2 -outline-offset-2 outline-success')}>
              <span className={number}>{data.won}</span>
              <span className={label}>
                <Icon name="check-circle" className="size-4" />
                {staffCopy.week.won}
              </span>
            </li>
            <li className={cn(tile, changed === 'lost' && 'outline-2 -outline-offset-2 outline-success')}>
              <span className={number}>{data.lost}</span>
              <span className={label}>
                <Icon name="x-circle" className="size-4" />
                {staffCopy.week.lost}
              </span>
            </li>
          </ul>
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      ) : (
        <div role="status" className="flex flex-wrap items-center gap-md rounded-lg bg-surface-raised p-md">
          <Icon name="alert" className="text-warning" />
          <span className={type.label}>{staffCopy.week.unavailable}</span>
          <Button onClick={() => void week.refetch()} paused={week.isFetching}>
            <Icon name="refresh" className="size-4" />
            {staffCopy.week.retry}
          </Button>
        </div>
      )}
    </section>
  );
}
