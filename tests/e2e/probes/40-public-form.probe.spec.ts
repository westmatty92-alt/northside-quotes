// QA2 probes, part 4: the public form's abuse controls, driven straight at the API like a bot would (no browser).
// Every request this file stores is named "QA-PROBE <run id> ..." and carries script text in its free-text fields;
// they are listed in docs/qa-reports/QA2-run.md and in tests/e2e/probes/created.ndjson. Nothing else is stored.
//   PRB-30  AC-003.2 AC-003.7  30 honeypot refusals from one address: 30 x 400, identical bodies, nothing stored,
//                              exactly 1 spam event with count 30 and no address in it
//   PRB-31  AC-003.3           a token under 3 seconds old is refused with the same body; a missing or forged token is 401
//   PRB-32  AC-003.4 SEC-3     20 parallel creates from one address accept exactly 5, refuse 15 with 429 and Retry-After,
//                              store exactly 5, and write 1 rate_limited event with count 15
//   PRB-33  AC-001.17 SEC-6    every accepted request stored with consent "maybe" has consent no, no consent time, no GoHighLevel copy;
//                              only a JSON true differs from a stored "no" (replay and 409)
//   PRB-34                     a token cannot complete another request; unknown ids and missing tokens are refused
import { test, expect } from '../support/fixtures';
import { fetchPublicPage, type Detail } from '../support/api';
import { CreateQuoteRequestResponse, SubmitQuoteRequestResponse } from '../../../src/lib/api/generated/index.zod';
import {
  appApi,
  contractIssues,
  expectNone,
  homeownerBody,
  isProblemJson,
  line,
  lineWithBody,
  loadState,
  newSupabase,
  newUuid,
  probeTag,
  problemOf,
  recordProbeCreated,
  reserveWholeWindow,
  saveState,
  sleep,
  spamDelta,
  spamEvents,
  stableBody,
  staffToken,
  XSS_IMG,
  XSS_SCRIPT,
} from './support';

interface Accepted {
  index: number;
  token: string;
  body: Record<string, unknown>;
  requestId: string;
  reference: string;
}

// What PRB-30 and PRB-32 hand to the later tests lives in the run's state file (see support.ts), so a failing test
// does not make the next ones throw.
const accepted = (): Accepted[] => loadState<Accepted[]>('accepted') ?? [];
const honeypotBody = (): string => loadState<string>('honeypotBody') ?? '';

const ADDRESS_LIKE = /\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[0-9a-f]{64}\b|(?:[0-9a-f]{1,4}:){3,}/i;

test.describe('public form abuse controls @probe', () => {
  test('@probe PRB-30 AC-003.2 AC-003.7 30 honeypot submissions from one address are all refused alike, store nothing, and make one spam event with count 30 and no address', async ({ playwright }, testInfo) => {
    const token = await staffToken(playwright, 'owner');
    const sb = await newSupabase(playwright, token);
    const anon = await appApi(playwright);
    const before = await spamEvents(sb);

    const tokens: string[] = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const pages = await Promise.all(Array.from({ length: 10 }, () => fetchPublicPage(anon)));
      for (const p of pages) {
        if (!p.token) throw new Error(`no form token on GET /: ${line('GET /', p.res)}`);
        tokens.push(p.token);
      }
    }
    await sleep(3_600); // past the 3-second time trap, so the honeypot is the only reason to refuse
    const bodies: string[] = [];
    const failures: string[] = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const slice = tokens.slice(batch * 10, batch * 10 + 10);
      const results = await Promise.all(
        slice.map((t, i) =>
          anon.post('/api/quote-requests', { headers: { 'X-Form-Token': t }, data: homeownerBody(`${probeTag()} honeypot ${batch * 10 + i}`, batch * 10 + i, { website: 'https://spam.example/buy' }) }),
        ),
      );
      for (const res of results) {
        if (res.status() !== 400) failures.push(`${await lineWithBody('POST /api/quote-requests with the hidden field filled', res)} expected 400`);
        else if (!isProblemJson(res)) failures.push(`${line('honeypot refusal', res)} not problem+json`);
        bodies.push(await stableBody(res));
      }
    }
    const distinct = new Set(bodies);
    if (distinct.size !== 1) failures.push(`the 30 refusals are not identical (${distinct.size} different bodies)`);
    const refusal = bodies[0] ?? '';
    saveState('honeypotBody', refusal);
    const problem = JSON.parse(refusal || '{}') as { code?: string; reference?: unknown; request_id?: unknown };
    if (problem.code !== 'submission_refused') failures.push(`refusal code is ${String(problem.code)}, expected submission_refused`);
    if ('reference' in problem) failures.push('a refusal carries a reference number');

    const after = await spamEvents(sb);
    const delta = spamDelta(before, after, 'honeypot');
    if (delta.total !== 30) failures.push(`honeypot events gained a total count of ${delta.total}, expected 30`);
    if (delta.changed.length !== 1) failures.push(`${delta.changed.length} honeypot events changed, expected exactly 1`);
    for (const event of delta.changed) {
      if (event.keys.join(',') !== 'count,reason') failures.push(`the spam event holds the properties [${event.keys.join(', ')}], expected [count, reason]`);
      if (event.requestId !== null || event.userId !== null) failures.push('the spam event is linked to a request or a user');
      if (ADDRESS_LIKE.test(event.raw)) failures.push('the spam event contains something that looks like a network address or its hash');
    }
    await anon.dispose();
    await sb.dispose();
    await expectNone(testInfo, failures, 'honeypot refusals');
  });

  test('@probe PRB-31 AC-003.3 a token under 3 seconds old is refused with the same body as the honeypot; a missing, forged or garbage token is 401', async ({ playwright }, testInfo) => {
    const sb = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const anon = await appApi(playwright);
    const failures: string[] = [];
    const before = await spamEvents(sb);

    const page = await fetchPublicPage(anon);
    if (!page.token) throw new Error('no form token on GET /');
    const fast = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': page.token }, data: homeownerBody(`${probeTag()} too fast`, 40) });
    if (fast.status() !== 400) failures.push(`${await lineWithBody('POST under 3 seconds after the page loaded', fast)} expected 400`);
    const fastBody = await stableBody(fast);
    const honeypot = honeypotBody();
    if (honeypot && fastBody !== honeypot) failures.push('the under-3-seconds refusal body differs from the honeypot refusal body (the response must not say which check failed)');
    const delta = spamDelta(before, await spamEvents(sb), 'too_fast');
    if (delta.total !== 1) failures.push(`too_fast events gained a total count of ${delta.total}, expected 1`);

    const good = homeownerBody(`${probeTag()} bad token`, 41);
    const parts = page.token.split('.');
    const forgedSignature = `${parts.slice(0, 3).join('.')}.${(parts[3] ?? '').slice(0, -4)}AAAA`;
    const tokens: Array<[string, Record<string, string>]> = [
      ['no X-Form-Token header', {}],
      ['empty token', { 'X-Form-Token': '' }],
      ['garbage', { 'X-Form-Token': 'not-a-token' }],
      ['undefined', { 'X-Form-Token': 'undefined' }],
      ['right shape, forged signature', { 'X-Form-Token': forgedSignature }],
      ['issued in the future, unsigned', { 'X-Form-Token': `v1.${Date.now() + 3_600_000}.${newUuid()}.AAAA` }],
      ['issued 2 days ago, unsigned', { 'X-Form-Token': `v1.${Date.now() - 172_800_000}.${newUuid()}.AAAA` }],
    ];
    await sleep(3_600);
    for (const [label, headers] of tokens) {
      const res = await anon.post('/api/quote-requests', { headers, data: good });
      const problem = await problemOf(res);
      if (res.status() !== 401 || problem?.code !== 'form_token_invalid') failures.push(`${await lineWithBody(`POST /api/quote-requests [${label}]`, res)} expected 401 form_token_invalid`);
    }
    await anon.dispose();
    await sb.dispose();
    await expectNone(testInfo, failures, 'form-token checks');
  });

  test('@probe PRB-32 AC-003.4 SEC-3 20 parallel creates from one address accept exactly 5, refuse 15 with 429 and Retry-After, store exactly 5 and write one rate_limited event', async ({ playwright }, testInfo) => {
    const wait = await reserveWholeWindow(testInfo, 5); // the address starts the window with nothing used
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const sb = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const anon = await appApi(playwright);
    const before = await spamEvents(sb);

    const tokens: string[] = [];
    for (let batch = 0; batch < 2; batch += 1) {
      const pages = await Promise.all(Array.from({ length: 10 }, () => fetchPublicPage(anon)));
      for (const p of pages) {
        if (!p.token) throw new Error(`no form token on GET /: ${line('GET /', p.res)}`);
        tokens.push(p.token);
      }
    }
    await sleep(3_600);
    const bodies = tokens.map((_, i) =>
      homeownerBody(`${probeTag()} ${String(i).padStart(2, '0')} ${XSS_IMG}`, i, {
        address: `${XSS_SCRIPT} ${i} Probe St`,
        problem: `${probeTag()} ${XSS_SCRIPT} request ${i}: the tap drips constantly`,
        marketing_consent: 'maybe',
      }),
    );
    const results = await Promise.all(tokens.map((t, i) => anon.post('/api/quote-requests', { headers: { 'X-Form-Token': t }, data: bodies[i] })));
    const tally = new Map<number, number>();
    for (const r of results) tally.set(r.status(), (tally.get(r.status()) ?? 0) + 1);
    const summary = [...tally.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${n} x ${s}`).join(', ');
    testInfo.annotations.push({ type: 'burst', description: `20 parallel creates: ${summary} (waited ${Math.ceil(wait.waitedMs / 1000)}s for an empty window)` });

    const failures: string[] = [];
    const stored: Accepted[] = [];
    if (tally.get(201) !== 5) failures.push(`${tally.get(201) ?? 0} creates were accepted (201), expected exactly 5. All statuses: ${summary}`);
    if (tally.get(429) !== 15) failures.push(`${tally.get(429) ?? 0} creates were refused with 429, expected 15. All statuses: ${summary}`);
    for (let i = 0; i < results.length; i += 1) {
      const res = results[i];
      if (!res) continue;
      if (res.status() === 429) {
        const retry = res.headers()['retry-after'];
        const problem = await problemOf(res);
        if (!retry || !/^\d+$/.test(retry) || Number(retry) < 1 || Number(retry) > 600) failures.push(`${line(`create #${i} refused`, res)} Retry-After is "${String(retry)}", expected whole seconds from 1 to 600`);
        if (problem?.code !== 'rate_limited') failures.push(`${line(`create #${i} refused`, res)} code is ${String(problem?.code)}, expected rate_limited`);
        if (problem?.title !== 'Too many requests. Please try again in a few minutes.') failures.push(`${line(`create #${i} refused`, res)} title is "${String(problem?.title)}"`);
      } else if (res.status() === 201) {
        const json = (await res.json()) as { request_id: string };
        failures.push(...contractIssues(CreateQuoteRequestResponse, json, 'POST /api/quote-requests 201'));
        const token = tokens[i];
        const body = bodies[i];
        if (token && body) stored.push({ index: i, token, body, requestId: json.request_id, reference: '' });
      } else if (res.status() >= 500) {
        failures.push(`${await lineWithBody(`create #${i}`, res)} server error`);
      }
    }

    // Complete the accepted five: a submission takes no slot, so the limit does not get in the way.
    for (const a of stored) {
      const done = await anon.post(`/api/quote-requests/${a.requestId}/submission`, { headers: { 'X-Form-Token': a.token } });
      if (done.status() !== 200) {
        failures.push(`${await lineWithBody(`submission of accepted create #${a.index}`, done)} expected 200`);
        continue;
      }
      const submitted: unknown = await done.json();
      failures.push(...contractIssues(SubmitQuoteRequestResponse, submitted, 'POST /api/quote-requests/{id}/submission 200'));
      a.reference = (submitted as { reference: string }).reference;
      recordProbeCreated({ reference: a.reference, name: String(a.body['name']), note: 'burst of 20 parallel creates; script text in name, address and problem; offers value "maybe"' });
    }

    saveState('accepted', stored); // the later tests (consent, tokens, script text) work on these
    // Exactly five are stored, and none of the fifteen refused ones.
    const listed = await owner.get(`/api/quote-requests?q=${encodeURIComponent(probeTag())}&limit=100`);
    const names = listed.status() === 200 ? ((await listed.json()) as { data: Array<{ name: string }> }).data.filter((r) => r.name.startsWith(probeTag())) : [];
    if (listed.status() !== 200) failures.push(`${await lineWithBody('staff search for this run\'s requests', listed)} expected 200`);
    else if (names.length !== stored.length || names.length !== 5) failures.push(`staff see ${names.length} requests tagged ${probeTag()}, expected exactly 5 (the accepted ones)`);

    // One spam event for the refusals of this window, with the count of all 15 and nothing else.
    const delta = spamDelta(before, await spamEvents(sb), 'rate_limited');
    if (delta.total !== 15) failures.push(`rate_limited events gained a total count of ${delta.total}, expected 15`);
    if (delta.changed.length !== 1) failures.push(`${delta.changed.length} rate_limited events changed, expected exactly 1`);

    await owner.dispose();
    await sb.dispose();
    await anon.dispose();
    await expectNone(testInfo, failures, 'the 20-parallel burst');
  });

  test('@probe PRB-33 AC-001.17 every request stored with offers value "maybe" has consent no, no consent time and no GoHighLevel copy; only a JSON true differs from a stored no', async ({ playwright }, testInfo) => {
    const list = accepted();
    expect(list.length, 'PRB-32 must have accepted requests for this check').toBeGreaterThan(0);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const anon = await appApi(playwright);
    const failures: string[] = [];
    for (const a of list) {
      const res = await owner.get(`/api/quote-requests/${a.requestId}`);
      if (res.status() !== 200) {
        failures.push(`${await lineWithBody(`staff read of ${a.reference}`, res)} expected 200`);
        continue;
      }
      const d = (await res.json()) as Detail;
      if (d.marketing_consent !== false) failures.push(`${a.reference}: marketing_consent is ${String(d.marketing_consent)}, expected false for the value "maybe"`);
      if (d.marketing_consent_at !== null) failures.push(`${a.reference}: a consent time is stored without a clear yes`);
      if (d.ghl.copy.state !== 'not_copied_no_consent') failures.push(`${a.reference}: copy state is ${d.ghl.copy.state}, expected not_copied_no_consent`);
      if (d.ghl.stage_tag !== null) failures.push(`${a.reference}: a stage tag state exists for an unticked request`);
      if (d.status !== 'new' || d.price_cents !== null || d.note !== null) failures.push(`${a.reference}: status, price or note is not the default (${d.status}, ${String(d.price_cents)}, ${String(d.note)})`);
    }

    // Replay the first request's token with every other kind of "yes-looking" value. Each coerces to no, so each is the
    // same answers as the stored request: 200 and the same request. Only the JSON value true is a different answer.
    const first = list[0];
    if (!first) throw new Error('no accepted request to replay');
    const lookalikes: Array<[string, unknown]> = [
      ['maybe', 'maybe'],
      ['"true" (text)', 'true'],
      ['"TRUE"', 'TRUE'],
      ['"yes"', 'yes'],
      ['"on"', 'on'],
      ['1', 1],
      ['0', 0],
      ['null', null],
      ['false', false],
      ['[]', []],
      ['{}', {}],
      ['[true]', [true]],
    ];
    for (const [label, value] of lookalikes) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': first.token }, data: { ...first.body, marketing_consent: value } });
      const json = res.status() === 200 ? ((await res.json()) as { request_id?: string; reference?: string; submission_state?: string }) : null;
      if (res.status() !== 200 || json?.request_id !== first.requestId || json?.reference !== first.reference || json?.submission_state !== 'submitted') {
        failures.push(`${await lineWithBody(`replay with offers value ${label}`, res)} expected 200 and the same submitted request (a value other than JSON true must count as no)`);
      }
    }
    const asTrue = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': first.token }, data: { ...first.body, marketing_consent: true } });
    const asTrueProblem = await problemOf(asTrue);
    if (asTrue.status() !== 409 || asTrueProblem?.code !== 'form_already_used') failures.push(`${await lineWithBody('replay with JSON true (the only value that is a yes)', asTrue)} expected 409 form_already_used`);
    // Changed text on a submitted request is refused and changes nothing.
    const changed = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': first.token }, data: { ...first.body, name: `${String(first.body['name'])} changed`, marketing_consent: 'maybe' } });
    const changedProblem = await problemOf(changed);
    if (changed.status() !== 409 || changedProblem?.code !== 'form_already_used') failures.push(`${await lineWithBody('replay with a changed name', changed)} expected 409 form_already_used`);
    const after = (await (await owner.get(`/api/quote-requests/${first.requestId}`)).json()) as Detail;
    if (after.marketing_consent !== false || after.marketing_consent_at !== null) failures.push('the stored consent changed after the replays (consent is immutable, NG-16)');
    if (after.name !== first.body['name']) failures.push('the stored name changed after a refused replay');

    await owner.dispose();
    await anon.dispose();
    await expectNone(testInfo, failures, 'consent coercion');
  });

  test('@probe PRB-34 a token cannot complete another request; an unknown id, a missing token and a forged token are refused', async ({ playwright }, testInfo) => {
    const list = accepted();
    expect(list.length, 'PRB-32 must have accepted at least two requests').toBeGreaterThan(1);
    const anon = await appApi(playwright);
    const [a, b] = list;
    if (!a || !b) throw new Error('need two accepted requests');
    const failures: string[] = [];
    const cases: Array<[string, string, Record<string, string>, number[], string]> = [
      ["another request's token", `/api/quote-requests/${a.requestId}/submission`, { 'X-Form-Token': b.token }, [401], 'form_token_invalid'],
      ['no token', `/api/quote-requests/${a.requestId}/submission`, {}, [401], 'form_token_invalid'],
      ['forged token', `/api/quote-requests/${a.requestId}/submission`, { 'X-Form-Token': `${b.token.slice(0, -4)}AAAA` }, [401], 'form_token_invalid'],
      ['an unknown request id with a valid token', `/api/quote-requests/${newUuid()}/submission`, { 'X-Form-Token': a.token }, [401, 404], ''],
      ['a malformed request id', '/api/quote-requests/not-a-uuid/submission', { 'X-Form-Token': a.token }, [400, 401, 404, 422], ''],
    ];
    for (const [label, path, headers, statuses, code] of cases) {
      const res = await anon.post(path, { headers });
      const problem = await problemOf(res);
      if (!statuses.includes(res.status())) failures.push(`${await lineWithBody(`POST submission [${label}]`, res)} expected ${statuses.join(' or ')}`);
      else if (code && problem?.code !== code) failures.push(`${line(`POST submission [${label}]`, res)} code is ${String(problem?.code)}, expected ${code}`);
    }
    await anon.dispose();
    await expectNone(testInfo, failures, 'submission token checks');
  });
});
