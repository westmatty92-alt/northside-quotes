// orval.config.ts: generates the front-end's whole API layer from the locked contract.
// Owned by bl-architect. Output is GENERATED: never edit src/lib/api/generated/ by hand.
// Run via `npm run gen:types`. Re-run after every contract change; a diff in generated files
// without a contract change means someone edited generated code
// (`node scripts/check-code-guards.mjs generated` catches it).
//
// The `Photo storage` tag (uploadQuotePhoto) is excluded: Supabase Storage implements it and the
// frontend calls it through supabase-js (docs/architecture.md, "Orval note for A2").
// `QuoteRequestCreate.marketing_consent` has no type on purpose, so it generates as `unknown`;
// the frontend sends a boolean and the backend coerces with `value === true` (AC-001.17).
//
// Orval 8 notes: GET → useQuery and writes → useMutation by default; `formatter` replaces the old
// `prettier: true`; the contract's relative server URL (/api) isn't applied automatically, so
// baseUrl sets it.
import { defineConfig } from 'orval';

const input = {
  target: './docs/openapi.yaml',
  filters: { mode: 'exclude' as const, tags: ['Photo storage'] },
};

export default defineConfig({
  api: {
    input,
    output: {
      mode: 'tags-split', // one folder per OpenAPI tag (inbox/, public-form/, weekly-count/, ...)
      target: './src/lib/api/generated',
      schemas: './src/lib/api/generated/model',
      client: 'react-query', // TanStack Query hooks: useListQuoteRequests, useChangeQuoteRequestStatus, ...
      httpClient: 'fetch',
      baseUrl: '/api',
      mock: true, // MSW handlers + faker data, built from the contract
      clean: true,
      formatter: 'prettier',
      override: {
        mutator: {
          // the one hand-written piece (frontend lane): bearer token, problem+json errors
          path: './src/lib/api/fetcher.ts',
          name: 'apiFetch',
        },
        query: { signal: true },
      },
    },
  },
  apiZod: {
    // Zod schemas for runtime validation at the trust boundary (route handlers parse with these)
    input,
    output: {
      mode: 'tags-split',
      client: 'zod',
      target: './src/lib/api/generated',
      fileExtension: '.zod.ts',
      formatter: 'prettier',
    },
  },
});
