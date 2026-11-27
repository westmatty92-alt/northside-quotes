// What SCR-01 and SCR-02 keep in `sessionStorage` (one tab, gone when the tab closes):
//   - the nonces of form tokens that already carried a completed submission, so a page restored with such a token
//     (Back button, bfcache) refreshes it first (S0 SEC-2), and
//   - the receipt SCR-02 shows, so a reload in the same tab keeps showing the same reference number (the reference is
//     shown once and there is no lookup later, NG-3).
// Everything read back is checked with Zod: storage is untrusted input. A browser that blocks storage simply
// behaves as if nothing was kept.
import { z } from 'zod';
import { Urgency } from '@/lib/api/generated/model';
import { submitQuoteRequestResponseReferenceRegExp } from '@/lib/api/generated/public-form/public-form.zod';

const COMPLETED_KEY = 'nq.completed-form-nonces';
const RECEIPT_KEY = 'nq.receipt';
const CHANGED_EVENT = 'nq:session-store-changed';
const MAX_NONCES = 50;

const completedSchema = z.array(z.string().min(1).max(100)).max(MAX_NONCES);

export const receiptSchema = z.object({
  reference: z.string().regex(submitQuoteRequestResponseReferenceRegExp),
  firstName: z.string().min(1).max(100),
  phone: z.string().max(30),
  address: z.string().max(200),
  urgency: z.enum(Urgency),
  photoCount: z.number().int().min(0).max(3),
});
export type Receipt = z.infer<typeof receiptSchema>;

function read(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // storage blocked or full: carry on without it
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function parseJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** For `useSyncExternalStore`: tells React to re-read when this tab's storage changes or a page is restored. */
export function subscribeSessionStore(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener('pageshow', onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener('pageshow', onChange);
  };
}

// ---- completed nonces

export function readCompletedNonces(): readonly string[] {
  const parsed = completedSchema.safeParse(parseJson(read(COMPLETED_KEY)));
  return parsed.success ? parsed.data : [];
}

export function addCompletedNonce(nonce: string) {
  const next = [...readCompletedNonces().filter((existing) => existing !== nonce), nonce].slice(-MAX_NONCES);
  write(COMPLETED_KEY, JSON.stringify(next));
}

// ---- receipt

export function saveReceipt(receipt: Receipt) {
  write(RECEIPT_KEY, JSON.stringify(receipt));
}

/** The raw stored string: a primitive, so `useSyncExternalStore` sees a stable snapshot. */
export const getReceiptSnapshot = () => read(RECEIPT_KEY);
export function parseReceipt(raw: string): Receipt | null {
  const parsed = receiptSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}
