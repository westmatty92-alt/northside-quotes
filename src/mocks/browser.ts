// Starts the mock network in the browser (only ever imported, dynamically, when API mocking is on) and returns the
// seeds for the scenario named in `?mockScenario=`, if there is one: the request form's and the sign-in form's.
//
// It intercepts `fetch` in the page itself (msw's `defineNetwork` with a fetch interceptor), so there is no service
// worker script to serve or register and it behaves the same on localhost, on an http preview and under Playwright.
// supabase-js and the generated fetchers both go through `fetch`, so one network covers the API and Storage. It starts
// once per page load and keeps running across client-side navigation, so a request saved on one screen is still
// saved on the next.
import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { defineNetwork, InterceptorSource } from 'msw/experimental';
import type { FormPreview } from '@/components/request/preview-context';
import type { PipelinePreview } from '@/components/staff/pipeline/pipeline-preview';
import type { SignInPreview } from '@/components/staff/sign-in-preview';
import { buildHandlers } from '@/mocks/handlers';
import { pipelinePreviewFor, previewFor, signInPreviewFor } from '@/mocks/previews';
import { readScenario } from '@/mocks/scenarios';

export interface MockSeeds {
  form: FormPreview | undefined;
  signIn: SignInPreview | undefined;
  pipeline: PipelinePreview | undefined;
}

let started: Promise<MockSeeds> | undefined;

export function startMocking(): Promise<MockSeeds> {
  started ??= (async () => {
    const scenario = readScenario(window.location.search);
    const network = defineNetwork({
      sources: [new InterceptorSource({ interceptors: [new FetchInterceptor()] })],
      handlers: buildHandlers(scenario),
      // pages, scripts and fonts pass straight through; an /api call nobody mocked fails visibly in the checks
      onUnhandledFrame: 'bypass',
    });
    await network.enable();
    return { form: previewFor(scenario), signIn: signInPreviewFor(scenario), pipeline: pipelinePreviewFor(scenario) };
  })();
  return started;
}
