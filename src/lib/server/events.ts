import 'server-only';

// src/lib/server/events.ts: the events the app writes itself (docs/metrics-spec.md; ids, enums and counts only).
// quote_request_submitted, quote_request_quoted, quote_request_status_changed and the ghl_* events are written inside
// their database functions; this module writes the two the route has to: the capped spam refusal and photo_upload_failed.
// Both are best effort: a failure is logged as { error_class, code } only and never changes the answer to the caller.
// One of the modules allowed to use the service-role client (SECURITY_MODEL invariant 2).
import { getAdminClient } from '@/lib/server/admin';
import { dbErrorFields, errorFields } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';

export type SpamReason = 'honeypot' | 'too_fast' | 'rate_limited';
export type PhotoFailureReason = 'too_large' | 'bad_type' | 'storage_error';

/**
 * record_spam_refusal(ip_hash, reason): at most one spam_submission_blocked event per address and reason per 10 minutes
 * (its count rises), at most 1,000 a day, all inside one database call (SEC-14). Errors are ignored: the refusal the
 * caller sends is identical whether or not this worked.
 */
export async function recordSpamRefusal(ipHash: string, reason: SpamReason): Promise<void> {
  try {
    const { error } = await getAdminClient().rpc('record_spam_refusal', { p_ip_hash: ipHash, p_reason: reason });
    if (error) logLine('warn', { outcome: 'spam_refusal_not_recorded', ...dbErrorFields(error) });
  } catch (error) {
    logLine('warn', { outcome: 'spam_refusal_not_recorded', ...errorFields(error) });
  }
}

/** photo_upload_failed for one photo of a submission attempt (reason and photo position only; it hangs off the request id). */
export async function recordPhotoUploadFailed(requestId: string, reason: PhotoFailureReason, photoIndex: number): Promise<void> {
  try {
    const { error } = await getAdminClient()
      .from('events')
      .insert({ name: 'photo_upload_failed', request_id: requestId, properties: { reason, photo_index: photoIndex } });
    if (error) logLine('warn', { outcome: 'photo_event_not_recorded', quote_request_id: requestId, ...dbErrorFields(error) });
  } catch (error) {
    logLine('warn', { outcome: 'photo_event_not_recorded', quote_request_id: requestId, ...errorFields(error) });
  }
}
