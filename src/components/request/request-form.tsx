'use client';

// SCR-01 Request a quote: the form, the send, and what happens to the form token (docs/SECURITY_MODEL.md "One token
// per page load", architecture.md "Build requirements from S0", SEC-2).
//
// Token rules this component keeps:
//   - the page hands in one token per page load (`formToken`); it travels in the X-Form-Token header of both calls;
//   - after a completed send the token is dropped (its nonce goes into sessionStorage, so nothing can use it again),
//     `router.refresh()` fetches a new one, and the form goes to SCR-02;
//   - on mount and on `pageshow` (Back button, bfcache) a page whose token's nonce is listed refreshes first;
//   - on 409 form_already_used, 400 form_expired (and 401 form_token_invalid) the token is refreshed, every typed
//     value, photo and the offers box stay as they are, and she can send again.
// The offers box is never ticked on load, by script or by autofill, and keeps its state through every refusal.
import { useRouter } from 'next/navigation';
import { useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type BaseSyntheticEvent } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { copy } from '@/components/request/copy';
import { ErrorSummary, type SummaryItem } from '@/components/request/error-summary';
import { nonceOf } from '@/components/request/form-token';
import {
  cleanAnswers,
  EMPTY_VALUES,
  FIELD_ORDER,
  formResolver,
  isFieldName,
  type FieldName,
  type FormValues,
} from '@/components/request/form-values';
import { OffersCheckbox } from '@/components/request/offers-checkbox';
import { uploadPhoto } from '@/components/request/photo-upload';
import { PhotoPicker } from '@/components/request/photo-picker';
import { FormPreviewContext } from '@/components/request/preview-context';
import { addCompletedNonce, readCompletedNonces, saveReceipt } from '@/components/request/session-store';
import { classifyFailure, runSubmission, type UploadablePhoto } from '@/components/request/submit-flow';
import { UrgencyChoice } from '@/components/request/urgency-choice';
import { isAccepted, usePhotos } from '@/components/request/use-photos';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { type } from '@/components/ui/typography';
import type { QuoteRequestCreate } from '@/lib/api/generated/model';
import { useCreateQuoteRequest, useSubmitQuoteRequest } from '@/lib/api/generated/public-form/public-form';

interface RequestFormProps {
  /** One per page load, issued on the server (see src/app/(public)/page.tsx). */
  formToken: string;
}

type Notice =
  | { kind: 'summary'; items: readonly SummaryItem[] }
  | { kind: 'failed' }
  | { kind: 'rate-limited' };

const fieldTarget = (field: FieldName) => (field === 'urgency' ? 'urgency-emergency' : field);
const fieldItems = (fields: readonly FieldName[]): SummaryItem[] =>
  fields.map((field) => ({ targetId: fieldTarget(field), text: copy.summary.items[field] }));
const photoItem = (count: number): SummaryItem => ({ targetId: 'photos', text: copy.summary.photos(count) });

function GroupHeading({ children }: { children: string }) {
  return (
    <legend className="mb-sm p-0">
      <h2 className={type.h2}>{children}</h2>
    </legend>
  );
}

export function RequestForm({ formToken }: RequestFormProps) {
  const router = useRouter();
  const preview = useContext(FormPreviewContext);
  const nonce = nonceOf(formToken);

  const { register, handleSubmit, setValue, setError, formState } = useForm<FormValues>({
    defaultValues: { ...EMPTY_VALUES, ...preview?.values },
    resolver: formResolver,
    reValidateMode: 'onSubmit',
    shouldFocusError: false,
  });
  const { errors } = formState;
  const photos = usePhotos();

  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const refreshedFor = useRef<string | null>(null);
  const lastCreate = useRef<{ nonce: string; signature: string } | null>(null);
  const previewStarted = useRef(false);

  const create = useCreateQuoteRequest({ request: { headers: { 'X-Form-Token': formToken } } });
  const submit = useSubmitQuoteRequest({ request: { headers: { 'X-Form-Token': formToken } } });

  const refreshToken = useCallback(
    (force = false) => {
      if (!force && refreshedFor.current === nonce) return;
      refreshedFor.current = nonce;
      router.refresh();
    },
    [nonce, router],
  );

  // Never ticked on load, even if the browser restored an old form state. A scenario seed (mock mode) may set it.
  useEffect(() => {
    if (preview?.values.offers !== true) setValue('offers', false);
  }, [preview, setValue]);

  // On mount and on pageshow, a page whose token is listed refreshes first. A restored page is a new send, so
  // the offers box starts unticked again.
  useEffect(() => {
    const check = (restored: boolean) => {
      if (nonce === null || !readCompletedNonces().includes(nonce)) return;
      setValue('offers', false);
      refreshToken(restored);
    };
    check(false);
    const onPageShow = (event: PageTransitionEvent) => check(event.persisted);
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [nonce, refreshToken, setValue]);

  // A failed send moves focus to its summary or banner.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function showSummary(items: readonly SummaryItem[]) {
    setNotice({ kind: 'summary', items });
  }

  function onInvalid(fieldErrors: FieldErrors<FormValues>) {
    const refused = photos.getItems().filter((item) => item.problem?.blocking).length;
    const failing = FIELD_ORDER.filter((field) => fieldErrors[field]);
    showSummary([...fieldItems(failing), ...(refused > 0 ? [photoItem(refused)] : [])]);
  }

  async function onValid(values: FormValues) {
    if (sendingRef.current) return; // one tap, one request
    const refused = photos.getItems().filter((item) => item.problem?.blocking).length;
    if (refused > 0) {
      showSummary([photoItem(refused)]);
      return;
    }
    if (values.urgency === '') return; // the resolver has already refused this; narrows the type

    // A token that already completed a send is never used again: get a new one, keep everything.
    if (nonce !== null && readCompletedNonces().includes(nonce)) {
      refreshToken(true);
      setNotice({ kind: 'failed' });
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setNotice(null);

    const answers = cleanAnswers(values);
    const planned = photos.getItems().filter(isAccepted).flatMap((item) => (item.contentType ? [{ item, contentType: item.contentType }] : []));
    const body: QuoteRequestCreate = {
      ...answers,
      urgency: values.urgency,
      marketing_consent: values.offers === true, // only a real boolean true is a yes
      website: values.website,
      photos: planned.map(({ item, contentType }, index) => ({
        position: index + 1,
        content_type: contentType,
        size_bytes: item.file.size,
      })),
    };

    // Same token and same answers as the last try: photos already in Storage stay there. Changed answers clear them
    // on the server, so everything is uploaded again.
    const signature = JSON.stringify(body);
    const sameAnswers = lastCreate.current?.nonce === nonce && lastCreate.current?.signature === signature;
    const idByPosition = new Map<number, number>();
    const uploadables: UploadablePhoto[] = planned.map(({ item, contentType }, index) => {
      idByPosition.set(index + 1, item.id);
      if (!sameAnswers && item.status !== 'ready') photos.update(item.id, { status: 'ready', problem: null });
      return {
        position: index + 1,
        file: item.file,
        contentType,
        alreadyUploaded: sameAnswers && item.status === 'uploaded',
      };
    });

    try {
      const result = await runSubmission(
        body,
        uploadables,
        {
          create: async (data) => {
            const response = await create.mutateAsync({ data });
            if (nonce !== null) lastCreate.current = { nonce, signature };
            return response;
          },
          submit: (requestId) => submit.mutateAsync({ requestId }),
          upload: uploadPhoto,
        },
        (position, status) => {
          const id = idByPosition.get(position);
          if (id === undefined) return;
          photos.update(id, {
            status,
            problem: status === 'failed' ? { text: copy.photos.uploadFailed, blocking: false } : null,
          });
        },
      );

      // Done: keep the receipt for SCR-02, drop this token, fetch a new one, and go.
      saveReceipt({
        reference: result.reference,
        firstName: answers.name.split(/\s+/)[0] ?? answers.name,
        phone: answers.phone,
        address: answers.address,
        urgency: values.urgency,
        photoCount: result.photoCount,
      });
      if (nonce !== null) addCompletedNonce(nonce);
      refreshToken(true);
      router.push('/request-sent');
      return; // stays "Sending" until the page changes
    } catch (error) {
      const failure = classifyFailure(error);
      switch (failure.kind) {
        case 'validation': {
          const applied: FieldName[] = [];
          let refusedPhotos = 0;
          for (const item of failure.errors) {
            if (isFieldName(item.field)) {
              setError(item.field, { type: 'server', message: item.message });
              applied.push(item.field);
              continue;
            }
            const position = Number(/^photos\[(\d+)\]$/.exec(item.field)?.[1]);
            const id = idByPosition.get(position);
            if (id !== undefined) {
              photos.update(id, { status: 'ready', problem: { text: item.message, blocking: true } });
              refusedPhotos += 1;
            }
          }
          if (applied.length + refusedPhotos > 0) {
            showSummary([...fieldItems(applied), ...(refusedPhotos > 0 ? [photoItem(refusedPhotos)] : [])]);
          } else setNotice({ kind: 'failed' });
          break;
        }
        case 'photos': {
          let blocking = 0;
          for (const item of failure.photos) {
            const id = idByPosition.get(item.position);
            if (id === undefined) continue;
            photos.update(id, {
              status: item.retryable ? 'failed' : 'ready',
              problem: { text: item.message, blocking: !item.retryable },
            });
            if (!item.retryable) blocking += 1;
          }
          if (blocking > 0) showSummary([photoItem(blocking)]);
          else setNotice({ kind: 'failed' });
          break;
        }
        case 'rate-limited':
          setNotice({ kind: 'rate-limited' });
          break;
        case 'fresh-token':
          refreshToken(true);
          setNotice({ kind: 'failed' });
          break;
        default: // upload failure (the photo rows already say which) and everything else
          setNotice({ kind: 'failed' });
      }
    }
    sendingRef.current = false;
    setSending(false);
  }

  // handleSubmit is called when Send is pressed, not while rendering (the handlers read refs)
  const send = (event?: BaseSyntheticEvent) => handleSubmit(onValid, onInvalid)(event);

  // Mock mode only: a scenario seed can pick files and press Send once, so a refusal or failure shows on load.
  const runPreview = useEffectEvent(async () => {
    if (!preview) return;
    if (preview.files.length > 0) await photos.addFiles(preview.files);
    if (preview.autoSend) await send();
  });
  useEffect(() => {
    if (previewStarted.current) return;
    previewStarted.current = true;
    void runPreview();
  }, [preview]);

  return (
    <div className="grid gap-lg sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:p-lg">
      <div className="grid gap-md">
        <h1 className={type.h1}>{copy.title}</h1>
        {notice?.kind === 'summary' ? (
          <ErrorSummary ref={noticeRef} items={notice.items} />
        ) : notice?.kind === 'failed' ? (
          <Banner ref={noticeRef} variant="error" title={copy.failed.title}>
            <p>{copy.failed.body}</p>
          </Banner>
        ) : notice?.kind === 'rate-limited' ? (
          <Banner ref={noticeRef} variant="error" title={copy.rateLimited.title}>
            <p>{copy.rateLimited.body}</p>
          </Banner>
        ) : (
          <p className="text-body-lg leading-normal">{copy.lede}</p>
        )}
        {notice === null || notice.kind === 'summary' ? (
          <p className={type.hint}>{notice?.kind === 'summary' ? copy.requiredKept : copy.required}</p>
        ) : null}
      </div>

      <form noValidate onSubmit={send} aria-busy={sending} className="grid gap-lg">
        <fieldset className="grid min-w-0 gap-md">
          <GroupHeading>{copy.groups.details}</GroupHeading>
          <Field id="name" label={copy.labels.name} error={errors.name?.message}>
            {(aria) => <Input id="name" type="text" autoComplete="name" {...aria} {...register('name')} />}
          </Field>
          <Field id="phone" label={copy.labels.phone} hint={copy.hints.phone} error={errors.phone?.message}>
            {(aria) => (
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" {...aria} {...register('phone')} />
            )}
          </Field>
          <Field id="email" label={copy.labels.email} error={errors.email?.message}>
            {(aria) => <Input id="email" type="email" autoComplete="email" {...aria} {...register('email')} />}
          </Field>
        </fieldset>

        <fieldset className="grid min-w-0 gap-md">
          <GroupHeading>{copy.groups.problem}</GroupHeading>
          <Field id="address" label={copy.labels.address} error={errors.address?.message}>
            {(aria) => (
              <Input id="address" type="text" autoComplete="street-address" {...aria} {...register('address')} />
            )}
          </Field>
          <Field id="problem" label={copy.labels.problem} hint={copy.hints.problem} error={errors.problem?.message}>
            {(aria) => <Textarea id="problem" rows={4} {...aria} {...register('problem')} />}
          </Field>
          <UrgencyChoice field={register('urgency')} error={errors.urgency?.message} />
        </fieldset>

        <PhotoPicker
          items={photos.items}
          atLimit={photos.atLimit}
          sending={sending}
          onAdd={(files) => void photos.addFiles(files)}
          onRemove={photos.remove}
        />

        <div className="grid gap-md">
          <OffersCheckbox field={register('offers')} />
          <p className="leading-normal">{copy.dataUse}</p>
          {/* the honeypot: invisible, skipped by Tab, hidden from screen readers, never filled by autofill */}
          <div aria-hidden="true" className="sr-only">
            <input type="text" tabIndex={-1} autoComplete="off" {...register('website')} />
          </div>
          <Button type="submit" variant="primary" block paused={sending}>
            {sending ? copy.sending : copy.send}
          </Button>
          <p role="status" className="sr-only">
            {sending ? copy.sendingStatus : ''}
          </p>
        </div>
      </form>
    </div>
  );
}
