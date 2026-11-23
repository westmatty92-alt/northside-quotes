// What each scenario puts in front of the form (see scenarios.ts). Names and numbers are made-up examples on
// example.com and 555 numbers, like the mockups'. The files are real File objects with real type signatures, so the
// form checks them exactly as it checks a photo she picked.
import { saveReceipt } from '@/components/request/session-store';
import type { FormPreview } from '@/components/request/preview-context';
import type { FormValues } from '@/components/request/form-values';
import type { SignInPreview } from '@/components/staff/sign-in-preview';
import type { Scenario } from '@/mocks/scenarios';

const MB = 1_048_576;
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function file(name: string, type: string, megabytes: number, head: readonly number[]): File {
  const bytes = new Uint8Array(Math.round(megabytes * MB));
  bytes.set(head);
  return new File([bytes], name, { type });
}

const jpeg = (name: string, megabytes: number) => file(name, 'image/jpeg', megabytes, JPEG_HEAD);

const valid: Partial<FormValues> = {
  name: 'Dana Whitfield',
  phone: '905-555-0142',
  email: 'dana@example.com',
  address: '14 Barton St W, Hamilton ON',
  problem: 'Kitchen tap drips constantly and the cabinet under it is wet',
  urgency: 'soon',
};

const threePhotos = () => [jpeg('under-sink-1.jpg', 2.1), jpeg('cabinet-floor.jpg', 1.8), jpeg('pipe-close-up.jpg', 2.4)];

/** The form's starting point for a scenario, or undefined for a blank form. Also seeds sessionStorage for `sent`. */
export function previewFor(scenario: Scenario): FormPreview | undefined {
  switch (scenario) {
    case 'errors':
      return {
        values: { ...valid, phone: '12345', email: 'dana@', problem: 'Tap leaks', urgency: '', offers: true },
        files: [jpeg('under-sink-1.jpg', 2.1), file('plumber-quote.pdf', 'application/pdf', 0.4, PDF_HEAD), jpeg('IMG_4410.jpg', 6.3)],
        autoSend: true,
      };
    case 'send-failed':
    case 'rate-limited':
    case 'form-expired':
    case 'upload-failed':
      return { values: valid, files: threePhotos(), autoSend: true };
    case 'sent':
      saveReceipt({
        reference: 'NQ-7K3M9P',
        firstName: 'Dana',
        phone: '905-555-0142',
        address: '14 Barton St W, Hamilton ON',
        urgency: 'soon',
        photoCount: 2,
      });
      return undefined;
    case 'ok':
    // the staff scenarios change what the API answers, not what the public form starts with
    case 'signed-in':
    case 'empty':
    case 'error':
    case 'session-ended':
    case 'slow':
    case 'stale':
    case 'save-failed':
    case 'paused':
    case 'unavailable':
      return undefined;
  }
}

/** What SCR-03 starts with for a scenario: the sign-in scenarios press "Sign in" once on load. */
export function signInPreviewFor(scenario: Scenario): SignInPreview | undefined {
  switch (scenario) {
    case 'error':
      return { email: 'owner@example.com', password: 'not-the-password', autoSubmit: true };
    case 'paused':
    case 'unavailable':
      return { email: 'owner@example.com', password: 'correct-horse-battery-staple', autoSubmit: true };
    default:
      return undefined;
  }
}
