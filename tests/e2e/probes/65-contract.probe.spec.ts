// QA2 probes, part 7a: the deployed API against its contract, from outside. This is NOT the Schemathesis run (that
// is tests/fuzz/run.sh); it checks what a response must look like and how list parameters behave at their edges.
//   PRB-63  every GET response parses against the schema generated from docs/openapi.yaml and carries no undocumented
//           field (health, staff/me, weekly count, list pages, detail, photos)
//   PRB-64  error bodies are the contract's problem+json: status matches, code is one of the documented codes
//   PRB-66  list parameters at their edges: limit, status, q, cursor; injection-looking search text finds nothing
import { test, expect } from '../support/fixtures';
import {
  GetCurrentStaffResponse,
  GetCurrentWeeklyCountResponse,
  GetHealthResponse,
  GetQuoteRequestResponse,
  ListQuoteRequestPhotosResponse,
  ListQuoteRequestsResponse,
} from '../../../src/lib/api/generated/index.zod';
import type { ListItem } from '../support/api';
import { appApi, contractIssues, expectNone, isProblemJson, leaks, line, lineWithBody, newUuid, problemOf, staffToken } from './support';

const CODES = [
  'bad_request', 'validation_failed', 'submission_refused', 'form_expired', 'form_already_used', 'form_token_invalid', 'rate_limited',
  'unauthorized', 'session_expired', 'invalid_credentials', 'sign_in_paused', 'sign_in_unavailable', 'not_found', 'stale_version',
  'not_retryable', 'photo_missing', 'photo_invalid', 'method_not_allowed', 'service_unavailable', 'internal_error',
];

test.describe('contract conformance @probe', () => {
  test('@probe PRB-67 the checker itself: an undocumented field, a missing field and a wrong type are each reported (so a pass above means something)', () => {
    const good = { status: 'ok', version: 'abc1234' };
    expect(contractIssues(GetHealthResponse, good, 'good')).toEqual([]);
    expect(contractIssues(GetHealthResponse, { ...good, debug: true }, 'extra').join(' ')).toContain('undocumented field .debug');
    expect(contractIssues(GetHealthResponse, { status: 'ok' }, 'missing')).not.toEqual([]);
    expect(contractIssues(GetHealthResponse, { status: 'down', version: 'x' }, 'wrong value')).not.toEqual([]);
    const nested = { data: [{ id: newUuid(), reference: 'NQ-7K3M9P', name: 'Dana Whitfield', urgency: 'soon', status: 'new', submitted_at: '2026-11-19T14:10:00Z', version: 1, secret: 'x' }], next_cursor: null };
    expect(contractIssues(ListQuoteRequestsResponse, nested, 'nested').join(' ')).toContain('undocumented field .data[0].secret');
  });

  test('@probe PRB-63 every GET response conforms to the generated schema and holds no undocumented field', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const issues: string[] = [];
    let checked = 0;
    const check = (schema: Parameters<typeof contractIssues>[0], body: unknown, label: string) => {
      checked += 1;
      issues.push(...contractIssues(schema, body, label));
    };

    const health = await anon.get('/api/health');
    expect(health.status(), line('GET /api/health', health)).toBe(200);
    check(GetHealthResponse, await health.json(), 'GET /api/health');
    const me = await owner.get('/api/staff/me');
    check(GetCurrentStaffResponse, await me.json(), 'GET /api/staff/me');
    const week = await owner.get('/api/weekly-counts/current');
    check(GetCurrentWeeklyCountResponse, await week.json(), 'GET /api/weekly-counts/current');

    // The list: every status filter, a search, and three pages of 20 followed by their cursors.
    const seen = new Set<string>();
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const res = await owner.get(`/api/quote-requests?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status(), line(`GET list page ${page + 1}`, res)).toBe(200);
      const body = (await res.json()) as { data: ListItem[]; next_cursor: string | null };
      check(ListQuoteRequestsResponse, body, `GET /api/quote-requests page ${page + 1}`);
      for (const item of body.data) {
        if (seen.has(item.id)) issues.push(`list page ${page + 1}: ${item.reference} appears on two pages`);
        seen.add(item.id);
        ids.push(item.id);
      }
      for (let i = 1; i < body.data.length; i += 1) {
        const a = body.data[i - 1];
        const b = body.data[i];
        if (a && b && (a.submitted_at < b.submitted_at || (a.submitted_at === b.submitted_at && a.id < b.id))) issues.push(`list page ${page + 1}: order is not submitted_at desc, id desc at row ${i}`);
      }
      if (body.data.length > 20) issues.push(`list page ${page + 1}: ${body.data.length} rows for limit=20`);
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    for (const status of ['new', 'quoted', 'won', 'lost']) {
      const res = await owner.get(`/api/quote-requests?status=${status}&limit=50`);
      const body = (await res.json()) as { data: ListItem[] };
      check(ListQuoteRequestsResponse, body, `GET /api/quote-requests?status=${status}`);
      if (body.data.some((r) => r.status !== status)) issues.push(`status=${status}: the list holds a request in another status`);
    }
    const search = await owner.get('/api/quote-requests?q=QA-PROBE');
    check(ListQuoteRequestsResponse, await search.json(), 'GET /api/quote-requests?q=QA-PROBE');

    // Detail and photos for a spread of requests: the newest 12 (probe requests, with and without photos).
    let withPhotos = 0;
    for (const id of ids.slice(0, 12)) {
      const detail = await owner.get(`/api/quote-requests/${id}`);
      const body: unknown = await detail.json();
      check(GetQuoteRequestResponse, body, 'GET /api/quote-requests/{id}');
      const photoCount = (body as { photo_count?: number }).photo_count ?? 0;
      if (photoCount > 0) {
        withPhotos += 1;
        const photos = await owner.get(`/api/quote-requests/${id}/photos`);
        check(ListQuoteRequestPhotosResponse, await photos.json(), 'GET /api/quote-requests/{id}/photos');
      }
    }
    testInfo.annotations.push({ type: 'checked', description: `${checked} response bodies against the generated schema (${ids.length} list rows seen, ${withPhotos} requests with photos)` });
    await anon.dispose();
    await owner.dispose();
    await expectNone(testInfo, issues, 'contract conformance');
  });

  test('@probe PRB-64 error bodies are the contract problem+json: the status matches, the code is documented, nothing leaks', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const issues: string[] = [];
    const id = newUuid();
    const calls: Array<[string, () => ReturnType<typeof anon.get>, number[]]> = [
      ['401 list with no session', () => anon.get('/api/quote-requests'), [401]],
      ['404 detail of an unknown id', () => owner.get(`/api/quote-requests/${id}`), [404]],
      ['405 delete', () => owner.delete(`/api/quote-requests/${id}`), [405]],
      ['404 quote of an unknown id', () => owner.put(`/api/quote-requests/${id}/quote`, { data: { price_cents: null, note: null, version: 1 } }), [404]],
      ['400 or 422 list limit 0', () => owner.get('/api/quote-requests?limit=0'), [400, 422]],
      ['401 create with no form token', () => anon.post('/api/quote-requests', { data: {} }), [401]],
      ['401 job with no secret', () => anon.get('/api/jobs/ghl-sync'), [401]],
      ['400 sign-in with malformed JSON', () => anon.post('/api/auth/sign-in', { data: '{bad', headers: { 'content-type': 'application/json' } }), [400]],
    ];
    for (const [label, send, expected] of calls) {
      const res = await send();
      const problem = await problemOf(res);
      if (!expected.includes(res.status())) issues.push(`${await lineWithBody(label, res)} expected ${expected.join(' or ')}`);
      else if (!isProblemJson(res)) issues.push(`${line(label, res)} not application/problem+json`);
      else if (!problem || problem.status !== res.status()) issues.push(`${line(label, res)} body status ${String(problem?.status)} differs from the HTTP status`);
      else if (!problem.code || !CODES.includes(problem.code)) issues.push(`${line(label, res)} code "${String(problem.code)}" is not a documented code`);
      else if (!problem.title || !problem.type) issues.push(`${line(label, res)} missing type or title`);
      const leak = await leaks(res);
      if (leak) issues.push(`${line(label, res)} leaks "${leak}"`);
    }
    await anon.dispose();
    await owner.dispose();
    await expectNone(testInfo, issues, 'problem bodies');
  });

  test('@probe PRB-68 responses that carry personal data or signed photo links are not cacheable by a shared cache (Cache-Control no-store or private)', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const list = await owner.get('/api/quote-requests?limit=5');
    const rows = ((await list.json()) as { data: ListItem[] }).data;
    const first = rows[0];
    if (!first) throw new Error('no request exists to read');
    const paths = ['/api/quote-requests?limit=5', `/api/quote-requests/${first.id}`, `/api/quote-requests/${first.id}/photos`, '/api/staff/me', '/api/weekly-counts/current'];
    const issues: string[] = [];
    for (const path of paths) {
      const res = await owner.get(path);
      const cc = (res.headers()['cache-control'] ?? '').toLowerCase();
      if (res.status() !== 200) issues.push(`${line(`GET ${path.replace(first.id, '{id}')}`, res)} expected 200`);
      else if (!/no-store|private/.test(cc) || /\bpublic\b|s-maxage/.test(cc)) issues.push(`${line(`GET ${path.replace(first.id, '{id}')}`, res)} Cache-Control is "${cc || 'missing'}", expected no-store or private`);
    }
    const anon = await appApi(playwright);
    const refused = await anon.get('/api/quote-requests');
    const cc = (refused.headers()['cache-control'] ?? '').toLowerCase();
    if (/\bpublic\b|s-maxage/.test(cc)) issues.push(`${line('401 for a list with no session', refused)} Cache-Control is "${cc}": a refusal must not be cached for everyone`);
    await owner.dispose();
    await anon.dispose();
    await expectNone(testInfo, issues, 'cache headers on private responses');
  });

  test('@probe PRB-66 list parameters at their edges: limit, status, q and cursor are validated (never a 5xx); search text that looks like a filter or SQL finds nothing', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const issues: string[] = [];
    const bad: Array<[string, string]> = [
      ['limit=0', 'limit=0'],
      ['limit=101', 'limit=101'],
      ['limit=-1', 'limit=-1'],
      ['limit=abc', 'limit=abc'],
      ['limit=1.5', 'limit=1.5'],
      ['limit=', 'limit='],
      ['status=bogus', 'status=bogus'],
      ['status=NEW', 'status=NEW'],
      ['q empty', 'q='],
      ['q 101 characters', `q=${'a'.repeat(101)}`],
      ['cursor 201 characters', `cursor=${'a'.repeat(201)}`],
      ['cursor garbage', 'cursor=not-a-cursor'],
      ['cursor injection-looking', `cursor=${encodeURIComponent("'; drop table quote_requests;--")}`],
      ['cursor base64 of junk', `cursor=${Buffer.from('{"a":1}').toString('base64url')}`],
      ['repeated limit', 'limit=5&limit=500'],
    ];
    for (const [label, query] of bad) {
      const res = await owner.get(`/api/quote-requests?${query}`);
      if (![400, 422].includes(res.status())) issues.push(`${await lineWithBody(`list [${label}]`, res)} expected 400 or 422`);
      else if (!isProblemJson(res)) issues.push(`${line(`list [${label}]`, res)} not problem+json`);
      else {
        const leak = await leaks(res);
        if (leak) issues.push(`${line(`list [${label}]`, res)} leaks "${leak}"`);
      }
    }
    // Search text: a valid call (200) whose rows all really match, or an empty list. Never everything, never a 5xx.
    const searches = ["' OR 1=1 --", '%', '_', '*', '%27', '),id.not.is.null,(id.eq.', '.eq.x', 'name.ilike.*', '\\', '"', '{}', '😀', 'a'.repeat(100)];
    for (const text of searches) {
      const res = await owner.get(`/api/quote-requests?q=${encodeURIComponent(text)}&limit=100`);
      if (res.status() >= 500) {
        issues.push(`${await lineWithBody(`search [${text.slice(0, 20)}]`, res)} a server error`);
        continue;
      }
      if (res.status() !== 200) continue; // a validation refusal is fine
      const rows = ((await res.json()) as { data: Array<{ name: string; reference: string }> }).data;
      const wildcard = text === '%' || text === '_' || text === '*';
      if (!wildcard && rows.length > 0 && !rows.some((r) => r.name.toLowerCase().includes(text.toLowerCase()) || r.reference.toLowerCase().includes(text.toLowerCase()))) {
        issues.push(`search [${text.slice(0, 20)}] returned ${rows.length} rows that do not contain the text: the text was treated as a filter`);
      }
      if (['%', '_', '*'].includes(text) && rows.length > 0) {
        const all = await owner.get('/api/quote-requests?limit=100');
        const total = ((await all.json()) as { data: unknown[] }).data.length;
        if (rows.length === total && total > 3) issues.push(`search [${text}] returned every request: the character was treated as a wildcard (it should match only itself)`);
      }
    }
    await owner.dispose();
    await expectNone(testInfo, issues, 'list parameter edges');
  });
});
