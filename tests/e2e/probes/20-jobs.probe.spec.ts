// QA2 probes, part 2: the cron job routes (SECURITY_MODEL invariants 12 and 15, threat model SEC-4).
// QA holds no CRON_SECRET, so every request here must be refused. The happy path (a correct secret returns the job
// counts) is NOT proven by QA2 and is listed as unverified in the report.
//   PRB-10  /api/jobs/ghl-sync and /api/jobs/housekeeping with Bearer undefined, empty, missing, wrong, borrowed
//   PRB-11  spoofed cron headers, secrets in the query string, other methods
import { test, expect } from '../support/fixtures';
import { appApi, isProblemJson, leaks, line, problemOf, staffToken, supabaseTarget } from './support';

const JOBS = ['/api/jobs/ghl-sync', '/api/jobs/housekeeping'];
const JOB_RESULT_KEYS = ['claimed', 'succeeded', 'waiting', 'failed', 'pending_requests_purged', 'photos_purged', 'rate_limit_rows_purged', 'sign_in_rows_purged'];

test.describe('job route boundaries @probe', () => {
  test('@probe PRB-10 Bearer undefined, empty, missing, wrong, a staff token and the anon key all give 401 on both job routes', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const staff = await staffToken(playwright, 'owner');
    const anonKey = supabaseTarget().anonKey;
    const variants: Array<{ label: string; headers: Record<string, string> }> = [
      { label: 'no Authorization header', headers: {} },
      { label: 'Authorization empty', headers: { Authorization: '' } },
      { label: 'Bearer undefined', headers: { Authorization: 'Bearer undefined' } },
      { label: 'Bearer null', headers: { Authorization: 'Bearer null' } },
      { label: 'Bearer (empty token)', headers: { Authorization: 'Bearer ' } },
      { label: 'Bearer (no space)', headers: { Authorization: 'Bearer' } },
      { label: 'bearer undefined (lower case)', headers: { Authorization: 'bearer undefined' } },
      { label: 'Token undefined', headers: { Authorization: 'Token undefined' } },
      { label: 'Basic', headers: { Authorization: 'Basic dXNlcjpwYXNzd29yZA==' } },
      { label: 'Bearer + 32 x', headers: { Authorization: `Bearer ${'x'.repeat(32)}` } },
      { label: 'Bearer + 64 a', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } },
      { label: 'Bearer + 1 char', headers: { Authorization: 'Bearer x' } },
      { label: 'Bearer + a staff access token', headers: { Authorization: `Bearer ${staff}` } },
      { label: 'Bearer + the public anon key', headers: { Authorization: `Bearer ${anonKey}` } },
    ];
    const failures: string[] = [];
    let cases = 0;
    for (const path of JOBS) {
      for (const variant of variants) {
        cases += 1;
        const res = await anon.get(path, { headers: variant.headers });
        const label = `GET ${path} [${variant.label}]`;
        const problem = await problemOf(res);
        if (res.status() !== 401) failures.push(`${line(label, res)} expected 401`);
        else if (!isProblemJson(res)) failures.push(`${line(label, res)} not problem+json`);
        else if (problem && JOB_RESULT_KEYS.some((k) => k in problem)) failures.push(`${line(label, res)} the refusal carries job counts`);
        else {
          const leak = await leaks(res);
          if (leak) failures.push(`${line(label, res)} leaks "${leak}"`);
        }
      }
    }
    testInfo.annotations.push({ type: 'cases', description: `${cases} requests (${JOBS.length} routes x ${variants.length} Authorization values)` });
    await anon.dispose();
    expect(failures, 'job-route calls that were not refused with 401').toEqual([]);
  });

  test('@probe PRB-11 a spoofed cron header, a secret in the query string, or another method does not open the job routes', async ({ playwright }) => {
    const anon = await appApi(playwright);
    const failures: string[] = [];
    for (const path of JOBS) {
      const spoofs: Array<{ label: string; headers: Record<string, string>; query?: string }> = [
        { label: 'x-vercel-cron: 1', headers: { 'x-vercel-cron': '1' } },
        { label: 'user-agent vercel-cron/1.0', headers: { 'user-agent': 'vercel-cron/1.0' } },
        { label: 'x-vercel-signature', headers: { 'x-vercel-signature': 'abc' } },
        { label: 'x-forwarded-for 127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1' } },
        { label: 'secret in query ?secret=undefined', headers: {}, query: '?secret=undefined' },
        { label: 'secret in query ?authorization=Bearer%20undefined', headers: {}, query: '?authorization=Bearer%20undefined' },
        { label: 'secret in query ?cron_secret=', headers: {}, query: '?cron_secret=' },
      ];
      for (const spoof of spoofs) {
        const res = await anon.get(`${path}${spoof.query ?? ''}`, { headers: spoof.headers });
        if (res.status() !== 401) failures.push(`${line(`GET ${path} [${spoof.label}]`, res)} expected 401`);
      }
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        const res = await anon.fetch(path, { method, headers: { Authorization: 'Bearer undefined' } });
        if (![401, 405].includes(res.status())) failures.push(`${line(`${method} ${path} [Bearer undefined]`, res)} expected 401 or 405`);
      }
    }
    await anon.dispose();
    expect(failures, 'job-route calls that were not refused').toEqual([]);
  });
});
