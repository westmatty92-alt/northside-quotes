'use client';

// SCR-02 Request sent: the reference number, in the most findable way possible, because no email or text is sent.
//
// The receipt comes from sessionStorage, written by the form when the send completed. A reload in the same tab shows
// the same number; a visitor who arrives without one is sent to the form (the reference is shown once and there is
// no lookup, NG-3). It looks the same whether the offers box was ticked or not, and whether GoHighLevel copied the
// contact or not: this page knows nothing about either.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { copy } from '@/components/request/copy';
import { JobTag } from '@/components/request/job-tag';
import { getReceiptSnapshot, parseReceipt, subscribeSessionStore } from '@/components/request/session-store';
import { UrgencyChip } from '@/components/request/urgency-chip';
import { Button, linkButtonClass } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const sectionLabel = cn(type.labelSm, 'text-text-secondary');

// null = not known yet (the server render, and the first client render); '' = nothing stored
const clientSnapshot = (): string | null => getReceiptSnapshot();
const serverSnapshot = (): string | null => null;

export function RequestSent() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeSessionStore, clientSnapshot, serverSnapshot);
  const receipt = useMemo(() => (raw ? parseReceipt(raw) : null), [raw]);

  const heading = useRef<HTMLHeadingElement>(null);
  const [announced, setAnnounced] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Nothing kept for this tab: back to the form.
  useEffect(() => {
    if (raw !== null && receipt === null) router.replace('/');
  }, [raw, receipt, router]);

  // The confirmation is announced when the page loads: the live region exists first, its words arrive a moment later.
  // Focus moves to the heading, so a keyboard or screen-reader user starts at the news.
  useEffect(() => {
    if (!receipt) return;
    heading.current?.focus();
    const timer = window.setTimeout(() => setAnnounced(true), 150);
    return () => window.clearTimeout(timer);
  }, [receipt]);

  if (!receipt) return null;

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="grid gap-lg sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:p-lg">
      <div className="grid gap-md">
        <p role="status" className={cn('flex min-h-6 items-center gap-sm', type.label)}>
          <Icon name="check-circle" className="text-success" />
          {announced ? copy.sent.status : ''}
        </p>
        {/* focus lands here on arrival so a keyboard or screen-reader user starts at the news; a heading is not a
            control, so it carries no ring of its own (every control on the page keeps the 3 px ring) */}
        <h1 ref={heading} tabIndex={-1} className={cn(type.h1, 'outline-none')}>
          {copy.sent.heading(receipt.firstName)}
        </h1>
      </div>

      <section aria-labelledby="ref-heading" className="grid justify-items-start gap-md">
        <h2 id="ref-heading" className={sectionLabel}>
          {copy.sent.referenceHeading}
        </h2>
        <JobTag reference={receipt.reference} variant="display" />
        <Button variant="primary" onClick={() => void copyReference(receipt.reference)}>
          <Icon name="copy" />
          {copy.sent.copyButton}
        </Button>
        <div role="status">{copied === 'copied' ? <p className={type.hint}>Copied.</p> : null}</div>
        {copied === 'failed' ? <FieldError>{copy.sent.copyFailed}</FieldError> : null}
      </section>

      <section aria-labelledby="next-heading" className="grid gap-md">
        <h2 id="next-heading" className={type.h2}>
          {copy.sent.nextHeading}
        </h2>
        <ul className="grid gap-md">
          {copy.sent.next.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sent-heading" className="grid gap-md rounded-lg bg-surface-raised p-md">
        <h2 id="sent-heading" className={sectionLabel}>
          {copy.sent.recapHeading}
        </h2>
        <dl className="grid gap-md">
          <div className="grid gap-xs">
            <dt className={sectionLabel}>{copy.sent.recap.phone}</dt>
            <dd>{receipt.phone}</dd>
          </div>
          <div className="grid gap-xs">
            <dt className={sectionLabel}>{copy.sent.recap.address}</dt>
            <dd>{receipt.address}</dd>
          </div>
          <div className="grid gap-xs">
            <dt className={sectionLabel}>{copy.sent.recap.urgency}</dt>
            <dd>
              <UrgencyChip urgency={receipt.urgency} />
            </dd>
          </div>
          <div className="grid gap-xs">
            <dt className={sectionLabel}>{copy.sent.recap.photos}</dt>
            <dd>{copy.sent.photosAttached(receipt.photoCount)}</dd>
          </div>
        </dl>
      </section>

      <div>
        <Link href="/" prefetch={false} className={linkButtonClass}>
          {copy.sent.another}
        </Link>
      </div>
    </div>
  );
}
