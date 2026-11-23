// Mock scenarios: `?mockScenario=<name>` on any page, honoured only in mock mode and only in this folder (the
// pages never read it). Each one makes a designed state reachable without a click.
//
// Public form (SCR-01, SCR-02):
//   ok             the API answers the happy path; the form starts blank (the default)
//   errors         SCR-01 with typed values the form refuses, two refused photos and the offers box ticked (no request is made)
//   send-failed    SCR-01 sends valid values once on load and the API answers 503 (failure banner, values kept)
//   rate-limited   as send-failed, but the API answers 429
//   form-expired   as send-failed, but the first answer is 400 form_expired (the page refreshes its token)
//   upload-failed  SCR-01 sends three photos once on load and the second one does not reach Storage
//   sent           SCR-02 with a receipt in sessionStorage, as if a send had just completed
//
// Staff screens (SCR-03, 04, 06, 07, 08). With no scenario (or `ok`) a staff page behaves as `signed-in`:
//   signed-in      an owner is signed in; eight requests, the weekly count 4, 1, 1; ids `mock-1` (offers box ticked,
//                  three photos) and `mock-2` (not ticked, no photos) open the first two requests
//   empty          no requests at all and a weekly count of 0, 0, 0
//   error          the list, the weekly count, a request and its photos answer 500; on SCR-03 one sign-in is
//                  attempted on load and answered 401 "Email or password is incorrect"
//   session-ended  every staff call answers 401 session_expired (the screens sign out and go to SCR-03)
//   slow           every staff call takes four seconds (the loading skeletons)
//   stale          a price save or status change answers 409 stale_version
//   save-failed    a price save or status change answers 500
//   moving         a status change never answers (SCR-05: the card stays marked "Saving")
//
// The Pipeline tab (SCR-05, /pipeline) with `stale`, `save-failed` and `moving` moves one card once the board has loaded
// (NQ-7K3M9P, New to Won, as if it had been dragged), so the refusal, the revert and the Saving state are reachable
// without a click or a drag. With `signed-in`, `empty`, `error` and `slow` the board is the plain list, empty columns,
// "can't load" and the loading skeleton.
//   paused         SCR-03: one sign-in is attempted on load and answered 429 sign_in_paused
//   unavailable    SCR-03: one sign-in is attempted on load and answered 503 sign_in_unavailable
import { z } from 'zod';

export const SCENARIOS = [
  'ok',
  'errors',
  'send-failed',
  'rate-limited',
  'form-expired',
  'upload-failed',
  'sent',
  'signed-in',
  'empty',
  'error',
  'session-ended',
  'slow',
  'stale',
  'save-failed',
  'moving',
  'paused',
  'unavailable',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const scenarioSchema = z.enum(SCENARIOS).catch('ok');

/** `search` is `window.location.search`; a missing or unknown name is `ok`. */
export function readScenario(search: string): Scenario {
  return scenarioSchema.parse(new URLSearchParams(search).get('mockScenario'));
}
