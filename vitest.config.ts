// vitest.config.ts: scaffold-owned (A2). `npm test` runs every lane's tests; `npm run test:offline`
// runs only the folders that need no database (src/, tests/unit/, tests/integrations/).
// Component tests opt into the DOM with a `// @vitest-environment jsdom` comment at the top of the file.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a React Server Components build; tests import server modules directly.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/api/**/*.test.{ts,tsx}',
      'tests/integrations/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
  },
});
