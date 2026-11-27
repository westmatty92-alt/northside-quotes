// POST /api/quote-requests/{request_id}/submission (operation submitQuoteRequest): complete a pending request once its
// photos are uploaded. A thin handler over src/lib/server/services/submissions.ts. When this call stored the request AND
// queued its GoHighLevel copy job (offers box ticked), the first attempt runs after the response through the integration
// seam; an unticked request queues nothing and calls nothing (AC-009.9).
import { after } from 'next/server';
import { runGhlJobs } from '@/lib/server/integrations/ghl';
import { errorFields, json, methodNotAllowed, withApi } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import { clientAddress } from '@/lib/server/services/network';
import { completeQuoteRequest } from '@/lib/server/services/submissions';

type Params = { params: Promise<{ request_id: string }> };

export const POST = withApi<Params>('POST /api/quote-requests/[request_id]/submission', async (req, ctx, { params }) => {
  const { request_id } = await params;
  const result = await completeQuoteRequest({
    formToken: req.headers.get('x-form-token'),
    requestId: request_id,
    clientAddress: clientAddress(req.headers),
  });

  if (result.jobQueued) {
    const requestId = result.body.request_id;
    after(async () => {
      try {
        await runGhlJobs({ requestId });
      } catch (error) {
        // runGhlJobs throws GhlStoreError on a database failure; the job stays queued for the cron run. Log the kind and the SQLSTATE only.
        logLine('error', { request_id: ctx.requestId, quote_request_id: requestId, outcome: 'ghl_first_attempt_failed', ...errorFields(error) });
      }
    });
  }
  return json(ctx, result.body);
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]/submission', ['POST']);
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
