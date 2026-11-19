// orval.config.ts: generates the front-end's whole API layer from the locked contract.
// Owned by bl-architect. Output is GENERATED: never edit src/lib/api/generated/ by hand.
// Run via `npm run gen:types`. Re-run after every contract change; a diff in generated files
// without a contract change means someone edited generated code.
//
// Orval 8 notes: GET → useQuery and writes → useMutation by default (setting useMutation: true
// would turn GETs into mutations too); `formatter` replaces the old `prettier: true`; the contract's
// relative server URL (/api) isn't applied automatically, so baseUrl sets it.
import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: { target: './docs/openapi.yaml' },
    output: {
      mode: 'tags-split', // one folder per OpenAPI tag (board/, jobs/, team/, …)
      target: './src/lib/api/generated',
      schemas: './src/lib/api/generated/model',
      client: 'react-query', // TanStack Query hooks: useGetBoard, useCreateJob, …
      httpClient: 'fetch',
      baseUrl: '/api',
      mock: true, // MSW handlers + faker data, built from the contract
      clean: true,
      formatter: 'prettier',
      override: {
        mutator: {
          // the one hand-written piece (frontend lane): credentials, problem+json errors
          path: './src/lib/api/fetcher.ts',
          name: 'apiFetch',
        },
        query: { signal: true },
      },
    },
  },
  apiZod: {
    // Zod schemas for runtime validation at the trust boundary (route handlers parse with these)
    input: { target: './docs/openapi.yaml' },
    output: {
      mode: 'tags-split',
      client: 'zod',
      target: './src/lib/api/generated',
      fileExtension: '.zod.ts',
      formatter: 'prettier',
    },
  },
});
