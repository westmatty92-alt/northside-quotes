// Mock scenarios: `?mockScenario=<name>` on any page, honoured only in mock mode and only in this folder (the
// pages never read it). Each one makes a designed state reachable without a click:
//   ok             the API answers the happy path; the form starts blank (the default)
//   errors         SCR-01 with typed values the form refuses, two refused photos and the offers box ticked (no request is made)
//   send-failed    SCR-01 sends valid values once on load and the API answers 503 (failure banner, values kept)
//   rate-limited   as send-failed, but the API answers 429
//   form-expired   as send-failed, but the first answer is 400 form_expired (the page refreshes its token)
//   upload-failed  SCR-01 sends three photos once on load and the second one does not reach Storage
//   sent           SCR-02 with a receipt in sessionStorage, as if a send had just completed
import { z } from 'zod';

export const SCENARIOS = ['ok', 'errors', 'send-failed', 'rate-limited', 'form-expired', 'upload-failed', 'sent'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const scenarioSchema = z.enum(SCENARIOS).catch('ok');

/** `search` is `window.location.search`; a missing or unknown name is `ok`. */
export function readScenario(search: string): Scenario {
  return scenarioSchema.parse(new URLSearchParams(search).get('mockScenario'));
}
