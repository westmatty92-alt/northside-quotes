// SCR-01 Request a quote: PLACEHOLDER from the A2 scaffold. The frontend lane replaces the body.
// Keep `await connection()` first: the page must render per request and never be prerendered or cached,
// because it will carry a fresh form token (S0 SEC-2; docs/architecture.md "Build requirements from S0").
import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Request a quote' };

export default async function RequestQuotePage() {
  await connection();
  return (
    <main>
      <h1>Request a quote</h1>
    </main>
  );
}
