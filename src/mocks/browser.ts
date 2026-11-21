// Starts the mock network in the browser (only ever imported, dynamically, when API mocking is on) and returns the
// form seed for the scenario named in `?mockScenario=`, if there is one.
//
// It intercepts `fetch` in the page itself (msw's `defineNetwork` with a fetch interceptor), so there is no service
// worker script to serve or register and it behaves the same on localhost, on an http preview and under Playwright.
// supabase-js and the generated fetchers both go through `fetch`, so one network covers the API and Storage.
import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { defineNetwork, InterceptorSource } from 'msw/experimental';
import type { FormPreview } from '@/components/request/preview-context';
import { buildHandlers } from '@/mocks/handlers';
import { previewFor } from '@/mocks/previews';
import { readScenario } from '@/mocks/scenarios';

let started: Promise<FormPreview | undefined> | undefined;

export function startMocking(): Promise<FormPreview | undefined> {
  started ??= (async () => {
    const scenario = readScenario(window.location.search);
    const network = defineNetwork({
      sources: [new InterceptorSource({ interceptors: [new FetchInterceptor()] })],
      handlers: buildHandlers(scenario),
      // pages, scripts and fonts pass straight through; an /api call nobody mocked fails visibly in the checks
      onUnhandledFrame: 'bypass',
    });
    await network.enable();
    return previewFor(scenario);
  })();
  return started;
}
