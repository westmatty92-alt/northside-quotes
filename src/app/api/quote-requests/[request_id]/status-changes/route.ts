// POST /api/quote-requests/{request_id}/status-changes (operation changeQuoteRequestStatus): a real change is 201, the
// same status again is 200 with changed false, a stale version is 409. After a real change that left a stage-tag push
// queued (a consented request only), the first attempt runs after the response through the integration seam; the status is
// saved whether or not GoHighLevel is reachable. A thin handler over src/lib/server/services/quote-requests.ts.
import { after } from 'next/server';
import { requireStaff } from '@/lib/server/auth/require-staff';
import { runGhlJobs } from '@/lib/server/integrations/ghl';
import { errorFields, json, methodNotAllowed, readJsonBody, withApi } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import { changeQuoteRequestStatus } from '@/lib/server/services/quote-requests';

type Params = { params: Promise<{ request_id: string }> };

export const POST = withApi<Params>('POST /api/quote-requests/[request_id]/status-changes', async (req, ctx, { params }) => {
  const staff = await requireStaff(req);
  const { request_id } = await params;
  const body = await readJsonBody(req);
  const result = await changeQuoteRequestStatus(staff.db, request_id, body);

  if (result.stageTagQueued) {
    after(async () => {
      try {
        await runGhlJobs({ requestId: request_id });
      } catch (error) {
        // runGhlJobs throws GhlStoreError on a database failure; the job stays queued for the cron run. Log the kind and the SQLSTATE only.
        logLine('error', { request_id: ctx.requestId, quote_request_id: request_id, outcome: 'ghl_stage_tag_attempt_failed', ...errorFields(error) });
      }
    });
  }
  return json(ctx, result.body, result.httpStatus);
});

const notAllowed = methodNotAllowed('/api/quote-requests/[request_id]/status-changes', ['POST']);
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
