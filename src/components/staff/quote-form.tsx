'use client';

// "Your quote" on SCR-06: the price and the note, either optional and either saved alone. The primary action of the
// screen ("Save price and note"). Saving a price never changes the status, and the screen says so (StatusControl).
//
// The client converts the typed amount to integer cents and refuses more than 2 decimals, a value outside 0.01 to
// 99,999.99, and a note over 1,000 characters BEFORE sending (docs/openapi.yaml saveQuote); the server checks again. A
// refusal shows a summary that links to each field and a message under the field, and everything typed stays. The
// request's `version` is the one she saw, read at the moment she saves; a 409 stale_version means someone else saved
// first: nothing is overwritten, the screen says so, and her note is kept below so she can copy it.
//
// Fields. The form's text is the user's draft (form state), set once from the request and re-set from a newer copy of
// the request only while she has typed nothing of her own, so an update from elsewhere never replaces her words.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { centsToInput, formatCents, parsePrice } from '@/components/staff/format';
import { Banner } from '@/components/ui/banner';
import { Button, focusRing } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { type } from '@/components/ui/typography';
import { useStaffRequest } from '@/hooks/use-staff-request';
import { isApiProblem } from '@/lib/api/fetcher';
import { getGetQuoteRequestQueryKey, useSaveQuote } from '@/lib/api/generated/inbox/inbox';
import { SaveQuoteResponse } from '@/lib/api/generated/inbox/inbox.zod';
import type { QuoteRequestDetail } from '@/lib/api/generated/model';
import { listQueryPrefix } from '@/components/staff/queries';
import { cn } from '@/lib/utils';

const words = staffCopy.detail;
const NOTE_MAX = 1000;

type FieldErrors = { price?: string; note?: string };
type Outcome = { kind: 'saved'; body: string } | { kind: 'failed' } | null;

interface QuoteFormProps {
  requestId: string;
  detail: QuoteRequestDetail;
  /** Someone else changed the request first (from here or from the status control): the form is replaced by the notice. */
  conflict: boolean;
  onConflict: () => void;
}

function draftOf(detail: Pick<QuoteRequestDetail, 'price_cents' | 'note'>) {
  return { price: detail.price_cents === null ? '' : centsToInput(detail.price_cents), note: detail.note ?? '' };
}

export function QuoteForm({ requestId, detail, conflict, onConflict }: QuoteFormProps) {
  const request = useStaffRequest();
  const queryClient = useQueryClient();
  const save = useSaveQuote({ request });
  const [draft, setDraft] = useState(() => draftOf(detail));
  const [served, setServed] = useState(() => draftOf(detail)); // what the request held when the draft was last in step
  const [errors, setErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<Outcome>(null);
  const summary = useRef<HTMLDivElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  const saved = useRef<HTMLDivElement>(null);

  // A newer copy of the request (a status change, a reload): follow it while she has typed nothing of her own.
  const incoming = draftOf(detail);
  if (incoming.price !== served.price || incoming.note !== served.note) {
    const untouched = draft.price === served.price && draft.note === served.note;
    setServed(incoming);
    if (untouched) setDraft(incoming);
  }

  const noteLength = draft.note.length;
  const errorList = Object.values(errors).filter(Boolean).length;

  useEffect(() => {
    if (errorList > 0) summary.current?.focus();
  }, [errors, errorList]);
  useEffect(() => {
    if (outcome?.kind === 'failed') failure.current?.focus();
  }, [outcome]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return; // one press, one save

    const price = parsePrice(draft.price);
    const next: FieldErrors = {
      ...(price.ok ? {} : { price: words.priceError }),
      ...(noteLength > NOTE_MAX ? { note: words.noteError(noteLength) } : {}),
    };
    setErrors(next);
    setOutcome(null);
    if (!price.ok || next.note) return;

    try {
      const response = await save.mutateAsync({
        requestId,
        data: { price_cents: price.cents, note: draft.note.trim() === '' ? null : draft.note, version: detail.version },
      });
      const updated = SaveQuoteResponse.parse(response.data);
      queryClient.setQueryData(getGetQuoteRequestQueryKey(requestId), response); // the screen shows what was stored
      const stored = draftOf(updated);
      setServed(stored);
      setDraft(stored);
      setOutcome({
        kind: 'saved',
        body: words.savedBody(updated.reference, updated.price_cents === null ? null : formatCents(updated.price_cents), updated.note !== null),
      });
      void queryClient.invalidateQueries({ queryKey: listQueryPrefix }); // the list's rows carry the request's version
    } catch (error) {
      if (isApiProblem(error)) {
        if (error.status === 401) return; // the session ended: the mutation cache takes her to SCR-03
        if (error.code === 'stale_version') return onConflict();
        if (error.status === 422 && error.problem?.errors?.length) {
          const fields = error.problem.errors;
          setErrors({
            ...(fields.some((item) => item.field === 'price_cents') ? { price: words.priceError } : {}),
            ...(fields.some((item) => item.field === 'note') ? { note: words.noteError(noteLength) } : {}),
          });
          return;
        }
      }
      setOutcome({ kind: 'failed' });
    }
  }

  // Someone else saved first: the typed note stays visible, to copy before reloading.
  if (conflict) {
    return (
      <div className="grid gap-md rounded-lg bg-surface-raised p-md">
        <h2 className={type.h2}>{words.quote}</h2>
        <Field id="kept-note" label={words.keptNote}>
          {(aria) => <Textarea {...aria} id="kept-note" readOnly rows={3} value={draft.note} />}
        </Field>
      </div>
    );
  }

  const hasQuote = detail.price_cents !== null || Boolean(detail.note);
  const label = (text: string) => (
    <>
      {text} <span className={cn(type.regular, 'text-text-secondary')}>{words.optional}</span>
    </>
  );

  return (
    <div className="grid gap-md">
      {outcome?.kind === 'saved' ? (
        <Banner ref={saved} variant="success" titleId="saved-title" title={words.saved}>
          <p>{outcome.body}</p>
        </Banner>
      ) : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate aria-labelledby="quote-heading" className="grid gap-md rounded-lg bg-surface-raised p-md">
        <h2 id="quote-heading" className={type.h2}>
          {words.quote}
        </h2>

        {errorList > 0 ? (
          <Banner ref={summary} variant="error" titleId="quote-errors" title={words.errorSummary(errorList)}>
            <ul className="grid gap-xs">
              {errors.price ? (
                <li>
                  <a href="#price" className={cn('underline underline-offset-4', focusRing)}>
                    {words.errorSummaryPrice(errors.price)}
                  </a>
                </li>
              ) : null}
              {errors.note ? (
                <li>
                  <a href="#note" className={cn('underline underline-offset-4', focusRing)}>
                    {words.errorSummaryNote}
                  </a>
                </li>
              ) : null}
            </ul>
          </Banner>
        ) : null}

        {outcome?.kind === 'failed' ? (
          <Banner ref={failure} variant="error" titleId="save-failed" title={words.saveFailed}>
            <p>{words.saveFailedBody}</p>
          </Banner>
        ) : null}

        {detail.price_cents !== null ? (
          <p className="flex flex-wrap items-baseline gap-sm">
            <span className={cn(type.h1)}>{formatCents(detail.price_cents)}</span>
            <span className="text-text-secondary">{words.priceLineSuffix}</span>
          </p>
        ) : null}
        {!hasQuote ? <p className="text-text-secondary">{words.quoteEmpty}</p> : null}

        <Field id="price" label={label(words.price)} hint={words.priceHint} {...(errors.price ? { error: errors.price } : {})}>
          {(aria) => (
            <div className="flex items-center gap-sm">
              <span aria-hidden="true" className={type.label}>
                $
              </span>
              <Input
                {...aria}
                id="price"
                name="price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="max-w-64 flex-1"
                value={draft.price}
                onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
              />
            </div>
          )}
        </Field>

        <Field
          id="note"
          label={label(words.note)}
          hint={noteLength === 0 ? words.noteHint : words.noteCount(noteLength)}
          {...(errors.note ? { error: errors.note } : {})}
        >
          {(aria) => (
            <Textarea
              {...aria}
              id="note"
              name="note"
              rows={4}
              value={draft.note}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          )}
        </Field>

        <Button type="submit" variant="primary" block paused={save.isPending}>
          {save.isPending ? words.saving : outcome?.kind === 'failed' ? words.saveAgain : words.save}
        </Button>
      </form>
    </div>
  );
}
