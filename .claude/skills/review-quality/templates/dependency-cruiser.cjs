/** Baseleap architecture boundaries (lane layout from arch-structure). Run by bl-reviewer:
 *  npx --yes dependency-cruiser@18 --config .dependency-cruiser.cjs --output-type err src
 *  Copy to the project root as .dependency-cruiser.cjs. Tune `pathNot` only through the architect. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'Circular imports make modules impossible to reason about or test alone.',
      from: { path: '^src' }, to: { circular: true } },
    { name: 'ui-not-server', severity: 'error', comment: 'Pages, components and hooks never import server-only code (DB, secrets, admin client). Go through the API.',
      from: { path: '^src/(app/\\(app\\)|app/embed|components|hooks)/' }, to: { path: '^src/lib/server/' } },
    { name: 'server-not-ui', severity: 'error', comment: 'Server code never imports UI.',
      from: { path: '^src/lib/server/' }, to: { path: '^src/(components|hooks|app/\\(app\\)|app/embed)/' } },
    { name: 'routes-thin', severity: 'warn', comment: 'Route handlers call services; they do not import the Supabase client directly.',
      from: { path: '^src/app/api/' }, to: { path: '^(node_modules/)?@supabase/(supabase-js|ssr)' } },
    { name: 'generated-read-only-entry', severity: 'error', comment: 'UI uses the generated API client only through src/lib/api (hooks/fetcher), never deep internal paths of other lanes.',
      from: { path: '^src/(components|hooks|app/\\(app\\))/' }, to: { path: '^src/lib/server/integrations/' } },
    { name: 'shared-is-leaf', severity: 'error', comment: 'src/lib/shared is used by every lane, so it imports nothing lane-specific.',
      from: { path: '^src/lib/shared/' }, to: { path: '^src/(lib/server|components|hooks|app)/' } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(^|/)(node_modules|\\.next|src/lib/api/generated)/' },
  },
};
