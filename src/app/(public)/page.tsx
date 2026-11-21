// SCR-01 Request a quote. Renders per request: `await connection()` comes before `issueFormToken()`, so a token never
// appears in a prerendered, ISR or CDN-cached response and no two visitors share one (S0 SEC-2; docs/SECURITY_MODEL.md
// "One token per page load"; next.config.ts adds `Cache-Control: private, no-store` for this path). Do not add
// `dynamic = 'force-static'`, `revalidate` or "use cache" here.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { RequestForm } from '@/components/request/request-form';
import { PublicPage } from '@/components/ui/site/public-page';
import { issueFormToken } from '@/lib/server/form-token';

export const metadata: Metadata = { title: 'Request a quote' };

export default async function RequestQuotePage() {
  await connection();
  const formToken = issueFormToken();
  return (
    <PublicPage>
      <RequestForm formToken={formToken} />
    </PublicPage>
  );
}
