// The mock API for the staff screens: the same operations the real backend answers (docs/openapi.yaml), with the
// contract's statuses and problem+json bodies, so the screens run unchanged against either. The state lives in memory
// for the life of the page: a saved price or a changed status is still there when the list is opened again.
//
// `scenario` (src/mocks/scenarios.ts) decides what goes wrong; see that file for the list.
import { delay, HttpResponse, http, type RequestHandler } from 'msw';
import type { Problem, ProblemCode, QuoteRequestDetail, Status } from '@/lib/api/generated/model';
import { ChangeQuoteRequestStatusBody, SaveQuoteBody } from '@/lib/api/generated/inbox/inbox.zod';
import { SignInBody } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { createStore, photosFor, resolveId, STAFF, summaryOf, WEEK, type MockStore } from '@/mocks/staff-data';
import type { Scenario } from '@/mocks/scenarios';

function problem(status: number, code: ProblemCode, title: string, errors?: Problem['errors']) {
  const body: Problem = { type: 'about:blank', title, status, code, ...(errors ? { errors } : {}) };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

const SESSION_ENDED = () => problem(401, 'session_expired', 'Your session ended.');
const NOT_FOUND = () => problem(404, 'not_found', 'Not found');
const BROKEN = () => problem(500, 'internal_error', 'Something went wrong');
const STALE = () => problem(409, 'stale_version', 'This request was changed by someone else. Reload to see the latest.');

const SLOW_MS = 4000;
const PAGE = 50;

function matchesSearch(detail: QuoteRequestDetail, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  // a phone is matched on its digits, only when what she typed looks like a phone number
  const digits = /^[\d\s().+-]+$/.test(needle) ? needle.replace(/\D/g, '') : '';
  return (
    detail.reference.toLowerCase().includes(needle) ||
    detail.name.toLowerCase().includes(needle) ||
    (digits.length > 0 && detail.phone.includes(digits))
  );
}

export function buildStaffHandlers(scenario: Scenario): RequestHandler[] {
  const store: MockStore = createStore();
  if (scenario === 'empty') {
    store.details = [];
    store.counts = { requests: 0, won: 0, lost: 0 };
  }

  /** Answers that apply to every staff call of a scenario, before the operation looks at anything. */
  const gate = async (): Promise<Response | undefined> => {
    if (scenario === 'slow') await delay(SLOW_MS);
    if (scenario === 'session-ended') return SESSION_ENDED();
    return undefined;
  };

  const find = (rawId: string | readonly string[] | undefined) => {
    const id = resolveId(String(rawId));
    return store.details.find((detail) => detail.id === id);
  };

  const touch = (detail: QuoteRequestDetail) => {
    detail.version += 1;
    detail.last_updated = { by_display_name: STAFF.display_name, at: new Date().toISOString() };
  };

  const list = http.get('*/api/quote-requests', async ({ request }) => {
    const refused = await gate();
    if (refused) return refused;
    if (scenario === 'error') return BROKEN();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q') ?? '';
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Number(url.searchParams.get('limit')) || PAGE, 100);
    const offset = cursor && /^o\d+$/.test(cursor) ? Number(cursor.slice(1)) : 0;
    const matching = store.details
      .filter((detail) => (!status || detail.status === status) && matchesSearch(detail, q))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id));
    const page = matching.slice(offset, offset + limit);
    const next = offset + limit < matching.length ? `o${offset + limit}` : null;
    return HttpResponse.json({ data: page.map(summaryOf), next_cursor: next });
  });

  const detail = http.get('*/api/quote-requests/:id', async ({ params }) => {
    const refused = await gate();
    if (refused) return refused;
    if (scenario === 'error') return BROKEN();
    const found = find(params.id);
    if (!found) return NOT_FOUND();
    // every read hands out the URLs it signs now (900 seconds, like Storage)
    return HttpResponse.json({ ...found, photos: photosFor(found.photo_count) });
  });

  const photos = http.get('*/api/quote-requests/:id/photos', async ({ params }) => {
    const refused = await gate();
    if (refused) return refused;
    if (scenario === 'error') return BROKEN();
    const found = find(params.id);
    if (!found) return NOT_FOUND();
    return HttpResponse.json({ data: photosFor(found.photo_count) });
  });

  const save = http.put('*/api/quote-requests/:id/quote', async ({ params, request }) => {
    const refused = await gate();
    if (refused) return refused;
    const found = find(params.id);
    if (!found) return NOT_FOUND();
    if (scenario === 'save-failed') return BROKEN();
    if (scenario === 'stale') return STALE();
    const parsed = SaveQuoteBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const errors = parsed.error.issues.flatMap((issue) =>
        typeof issue.path[0] === 'string' ? [{ field: issue.path[0], message: issue.message }] : [],
      );
      return problem(422, 'validation_failed', 'Some answers need fixing', errors);
    }
    if (parsed.data.version !== found.version) return STALE();
    found.price_cents = parsed.data.price_cents;
    found.note = parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null;
    touch(found);
    return HttpResponse.json({ ...found, photos: photosFor(found.photo_count) });
  });

  const changeStatus = http.post('*/api/quote-requests/:id/status-changes', async ({ params, request }) => {
    const refused = await gate();
    if (refused) return refused;
    const found = find(params.id);
    if (!found) return NOT_FOUND();
    if (scenario === 'save-failed') return BROKEN();
    if (scenario === 'stale') return STALE();
    const parsed = ChangeQuoteRequestStatusBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return problem(422, 'validation_failed', 'Some answers need fixing', [{ field: 'to_status', message: 'Choose a status' }]);
    if (parsed.data.version !== found.version) return STALE();
    if (parsed.data.to_status === found.status) {
      return HttpResponse.json({ changed: false, status: found.status, status_changed_at: found.status_changed_at, version: found.version });
    }
    const before: Status = found.status;
    const after: Status = parsed.data.to_status;
    if (before === 'won') store.counts.won = Math.max(0, store.counts.won - 1);
    if (before === 'lost') store.counts.lost = Math.max(0, store.counts.lost - 1);
    if (after === 'won') store.counts.won += 1;
    if (after === 'lost') store.counts.lost += 1;
    found.status = after;
    found.status_changed_at = new Date().toISOString();
    if (found.ghl.stage_tag) found.ghl = { ...found.ghl, stage_tag: { state: 'waiting', at: null } }; // only a ticked request has one
    touch(found);
    return HttpResponse.json({ changed: true, status: found.status, status_changed_at: found.status_changed_at, version: found.version }, { status: 201 });
  });

  const retryCopy = http.post('*/api/quote-requests/:id/ghl-copy-retries', async ({ params }) => {
    const refused = await gate();
    if (refused) return refused;
    const found = find(params.id);
    if (!found) return NOT_FOUND();
    if (found.ghl.copy.state !== 'failed') return problem(409, 'not_retryable', 'This copy cannot be retried now.');
    const at = new Date().toISOString();
    found.ghl = { copy: { state: 'copied', at }, stage_tag: { state: 'up_to_date', at } };
    return HttpResponse.json({ copy: found.ghl.copy, retried: true });
  });

  const week = http.get('*/api/weekly-counts/current', async () => {
    const refused = await gate();
    if (refused) return refused;
    if (scenario === 'error') return BROKEN();
    return HttpResponse.json({ ...WEEK, ...store.counts });
  });

  const me = http.get('*/api/staff/me', async () => {
    const refused = await gate();
    if (refused) return refused;
    return HttpResponse.json(STAFF);
  });

  const signIn = http.post('*/api/auth/sign-in', async ({ request }) => {
    if (scenario === 'paused') return problem(429, 'sign_in_paused', 'Too many sign-in attempts. Try again in a few minutes.');
    if (scenario === 'unavailable') return problem(503, 'sign_in_unavailable', 'Sign-in is unavailable. Try again in a few minutes.');
    const parsed = SignInBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return problem(422, 'validation_failed', 'Some answers need fixing', [{ field: 'email', message: 'Enter your email address' }]);
    if (scenario === 'error' || parsed.data.password === 'wrong') {
      return problem(401, 'invalid_credentials', 'Email or password is incorrect');
    }
    return HttpResponse.json(STAFF);
  });

  return [list, detail, photos, save, changeStatus, retryCopy, week, me, signIn];
}
