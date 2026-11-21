// SCR-02 Request sent. The reference number comes from this tab's sessionStorage (see RequestSent); without one the
// visitor is sent back to the form. Rendered per request like every public page: the per-request CSP nonce
// (src/proxy.ts) cannot work on a prerendered page.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { RequestSent } from '@/components/request/request-sent';
import { PublicPage } from '@/components/site/public-page';

export const metadata: Metadata = { title: 'Request sent' };

export default async function RequestSentPage() {
  await connection();
  return (
    <PublicPage>
      <RequestSent />
    </PublicPage>
  );
}
