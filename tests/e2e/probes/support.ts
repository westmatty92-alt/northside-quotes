// Shared helpers for the QA2 permission and abuse probes (tests/e2e/probes). Names only: no secret value is ever
// printed, attached or written.
//
// Two kinds of target, kept apart on purpose:
//   - the staging preview (the app: pages and /api). The Vercel protection bypass header goes here and nowhere else.
//   - the staging Supabase project (REST, Auth, Storage). Called like any browser client would: the public (anon)
//     key, or a staff access token. Never the bypass header, never the service role key.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import type { ZodType } from 'zod';
import { credentials, loadEnv, runId, stagingUrl, type Role } from '../support/env';
import { newApi, type Problem } from '../support/api';

type Playwright = PlaywrightWorkerArgs['playwright'];

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
export const newUuid = (): string => randomUUID();

/** Every request this suite creates starts with this, so staff can find (and Baseleap can remove) it. */
export const probeTag = (): string => `QA-PROBE ${runId()}`;

/** Script text for stored-XSS checks. Each must fit its field's length rules. */
export const XSS_IMG = '<img src=x onerror=window.__xss=1>';
export const XSS_SCRIPT = '"><script>window.__xss=1</script>';

export interface SupabaseTarget {
  origin: string;
  host: string;
  anonKey: string;
}

/** The staging Supabase project. Refuses anything that is not a *.supabase.co staging project. */
export function supabaseTarget(): SupabaseTarget {
  loadEnv();
  const url = process.env.SUPABASE_STAGING_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_STAGING_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('Set SUPABASE_STAGING_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local. Its value is never printed.');
  if (!anonKey) throw new Error('Set SUPABASE_STAGING_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local. Its value is never printed.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !parsed.host.endsWith('.supabase.co')) throw new Error(`Refusing to probe ${parsed.host}: not an https *.supabase.co project.`);
  const production = process.env.SUPABASE_PROD_PROJECT_REF;
  if (production && parsed.host.startsWith(`${production}.`)) throw new Error('Refusing to probe the production Supabase project.');
  const staging = process.env.SUPABASE_STAGING_REF;
  if (staging && !parsed.host.startsWith(`${staging}.`)) throw new Error('The Supabase URL is not the staging project named by SUPABASE_STAGING_REF.');
  return { origin: parsed.origin, host: parsed.host, anonKey };
}

/**
 * A client of the Supabase project. `token` is a staff access token; without it the anon key is also the bearer,
 * exactly as supabase-js sends it for a signed-out visitor. No Vercel bypass header here (it would not belong on
 * supabase.co and would leak the secret to a third party).
 */
export async function newSupabase(playwright: Playwright, token?: string): Promise<APIRequestContext> {
  const target = supabaseTarget();
  return playwright.request.newContext({
    baseURL: target.origin,
    extraHTTPHeaders: { apikey: target.anonKey, Authorization: `Bearer ${token ?? target.anonKey}` },
  });
}

const tokens = new Map<Role, string>();

/**
 * A staff access token, got the way a browser client gets one: Supabase Auth's password grant with the anon key.
 * This is a successful sign-in with the real staff account (allowed); it does not touch the app's failed-attempt
 * counters, and a failure here would be one failed attempt, so the call is made once per role per process.
 */
export async function staffToken(playwright: Playwright, role: Role): Promise<string> {
  const cached = tokens.get(role);
  if (cached) return cached;
  const { email, password } = credentials(role);
  const sb = await newSupabase(playwright);
  const res = await sb.post('/auth/v1/token?grant_type=password', { data: { email, password } });
  const status = res.status();
  const body = status === 200 ? ((await res.json()) as { access_token?: string }) : {};
  await sb.dispose();
  if (!body.access_token) throw new Error(`The ${role} sign-in through Supabase Auth failed (status ${status}); the body is not printed.`);
  tokens.set(role, body.access_token);
  return body.access_token;
}

/** The app API with no credentials, or with a staff token. Carries the Vercel bypass header for the preview host only. */
export function appApi(playwright: Playwright, token?: string): Promise<APIRequestContext> {
  return newApi(playwright, token);
}

/** Parse a response as a problem+json body when it is one (never throws). */
export async function problemOf(res: APIResponse): Promise<Problem | null> {
  try {
    return (await res.json()) as Problem;
  } catch {
    return null;
  }
}

export function isProblemJson(res: APIResponse): boolean {
  return (res.headers()['content-type'] ?? '').toLowerCase().startsWith('application/problem+json');
}

/** x-vercel-id of a response, for the ticket. */
export const vercelId = (res: APIResponse): string => res.headers()['x-vercel-id'] ?? 'n/a';

/** One line that says what a call was and what came back (no body: bodies can hold personal data). */
export function line(label: string, res: APIResponse): string {
  return `${label} -> ${res.status()} (${vercelId(res)})`;
}

/** Like `line`, plus who answered and the start of an error body. Only for refusals (4xx or 5xx): a 2xx body can hold personal data. */
export async function lineWithBody(label: string, res: APIResponse): Promise<string> {
  const server = res.headers()['server'] ?? 'n/a';
  const type = (res.headers()['content-type'] ?? 'n/a').split(';')[0];
  let body = '';
  if (res.status() >= 400) {
    try {
      body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
    } catch {
      body = '(unreadable)';
    }
  }
  return `${line(label, res)} server=${server} type=${type}${body ? ` body="${body}"` : ''}`;
}

/**
 * Vercel's edge refuses some hostile requests itself (a JWT with alg "none", a NUL byte in the path) with a plain-text
 * 403 or 400 before the app runs. The boundary holds (refused, no data) but the status is not the contract's 401 or 4xx
 * problem body, because the app never saw the request. Tests accept it only in exactly this form and record it.
 */
export function platformRefusal(res: APIResponse): boolean {
  const server = (res.headers()['server'] ?? '').toLowerCase();
  const type = (res.headers()['content-type'] ?? '').toLowerCase();
  return server === 'vercel' && type.startsWith('text/plain') && (res.status() === 400 || res.status() === 403);
}

/** Text that must never reach a client: database, provider or runtime internals. */
export const LEAK_PATTERN = /postgres|pgrst|stack trace|\bat\s+\S+\.(?:ts|js|mjs):\d+|invalid input syntax|violates|relation "|supabase\.co\/rest|service_role|node_modules/i;

export async function leaks(res: APIResponse): Promise<string | null> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }
  const hit = text.match(LEAK_PATTERN);
  return hit ? hit[0] : null;
}

/** A body with the volatile parts removed, to compare two refusals byte for byte. */
export async function stableBody(res: APIResponse): Promise<string> {
  const json = await problemOf(res);
  if (!json) return `non-json:${(await res.text()).slice(0, 200)}`;
  const copy: Record<string, unknown> = { ...json };
  delete copy.request_id;
  delete copy.instance;
  return JSON.stringify(copy, Object.keys(copy).sort());
}

/** Keys present in `input` that the schema did not keep: fields the contract does not document (Zod strips unknown keys). */
export function extraKeys(input: unknown, parsed: unknown, at = ''): string[] {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (Array.isArray(input) && Array.isArray(parsed)) return input.flatMap((v, i) => extraKeys(v, parsed[i], `${at}[${i}]`));
  if (isObject(input) && isObject(parsed)) {
    const out: string[] = [];
    for (const key of Object.keys(input)) {
      if (!(key in parsed)) out.push(`${at}.${key}`);
      else out.push(...extraKeys(input[key], parsed[key], `${at}.${key}`));
    }
    return out;
  }
  return [];
}

/**
 * Contract conformance of one response body against a schema generated from docs/openapi.yaml (Zod, from Orval):
 * the shape must parse, and no field may be present that the contract does not name (the qa-e2e "strict" rule).
 * Returns the problems, empty when the body conforms. Never includes values: bodies can hold personal data.
 */
export function contractIssues(schema: ZodType, body: unknown, label: string): string[] {
  const result = schema.safeParse(body);
  if (!result.success) return result.error.issues.slice(0, 5).map((i) => `${label}: ${i.path.join('.') || '(body)'} ${i.message}`);
  return extraKeys(body, result.data).map((key) => `${label}: undocumented field ${key}`);
}

/** Rows of PostgREST output, or null when the body is not an array. */
export async function rowsOf(res: APIResponse): Promise<unknown[] | null> {
  try {
    const json: unknown = await res.json();
    return Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

const CREATED = path.resolve(__dirname, 'created.ndjson');

/** Remember a request the probes created on the shared staging project (listed in docs/qa-reports/QA2-run.md). */
export function recordProbeCreated(entry: { reference: string | null; name: string; note: string }): void {
  fs.appendFileSync(CREATED, `${JSON.stringify({ at: new Date().toISOString(), run: runId(), ...entry })}\n`);
}

/**
 * Fail when any case failed. The message shows the count and the first lines; the whole list is attached to the test
 * (the report keeps it), so a long list never hides the first cause.
 */
export async function expectNone(testInfo: TestInfo, failures: string[], what: string): Promise<void> {
  if (failures.length > 0) {
    await testInfo.attach('failing-cases', { body: failures.join('\n'), contentType: 'text/plain' });
  }
  expect(failures.length, `${what}: ${failures.length} failing case(s)\n${failures.slice(0, 12).join('\n')}`).toBe(0);
}

// ---- State that one test hands to a later one -----------------------------------------------------------------------
// Playwright starts a fresh worker after a failed test, which would drop module variables and make every later test
// that needs them throw. So what a test hands on (the requests it made and their form tokens) is kept in a
// git-ignored file named for this run, and a failing test does not hide the ones after it.

const STATE_DIR = path.resolve(__dirname, '../../../playwright/.cache');
const stateFile = (): string => path.join(STATE_DIR, `probe-state-${runId()}.json`);

export function loadState<T>(key: string): T | undefined {
  try {
    const all = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
    return all[key] as T | undefined;
  } catch {
    return undefined;
  }
}

export function saveState(key: string, value: unknown): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
  } catch {
    all = {};
  }
  all[key] = value;
  fs.writeFileSync(stateFile(), JSON.stringify(all));
}

// ---- The shared submission limit (5 accepted per 10 minutes per address) ------------------------------------------

const SLOT_LEDGER = path.resolve(__dirname, '../../../playwright/.cache/submission-slots.json');
const WINDOW_MS = 10 * 60 * 1000;
const MARGIN_MS = 15_000;

function readLedger(): number[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SLOT_LEDGER, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Wait until every accepted submission this machine has recorded (QA1 and QA2 share one ledger,
 * playwright/.cache/submission-slots.json) is older than the 10-minute window, then reserve `count` slots. For the
 * "20 parallel creates accept exactly 5" probe, which needs the address to start the window with nothing used. The
 * wait is the rate limit being honoured; the test's timeout is extended by exactly that wait.
 */
export async function reserveWholeWindow(testInfo: TestInfo, count: number): Promise<{ waitedMs: number }> {
  fs.mkdirSync(path.dirname(SLOT_LEDGER), { recursive: true });
  const newest = Math.max(0, ...readLedger());
  const waitMs = Math.max(0, newest + WINDOW_MS + MARGIN_MS - Date.now());
  if (waitMs > 0) {
    testInfo.setTimeout(testInfo.timeout + waitMs + 5_000);
    testInfo.annotations.push({ type: 'rate-limit-wait', description: `waited ${Math.ceil(waitMs / 1000)}s so the address starts the 10-minute window with no accepted submission` });
    await sleep(waitMs);
  }
  const now = Date.now();
  fs.writeFileSync(SLOT_LEDGER, JSON.stringify(Array.from({ length: count }, () => now)));
  return { waitedMs: waitMs };
}

// ---- spam_submission_blocked events, read with a staff token (authenticated has select on events) --------------------

export interface SpamEvent {
  id: string;
  reason: string;
  count: number;
  keys: string[];
  raw: string;
  requestId: unknown;
  userId: unknown;
}

export async function spamEvents(sb: APIRequestContext): Promise<Map<string, SpamEvent>> {
  const res = await sb.get('/rest/v1/events?select=id,request_id,user_id,properties&name=eq.spam_submission_blocked&order=created_at.desc&limit=1000');
  const rows = res.status() === 200 ? await rowsOf(res) : null;
  if (!rows) throw new Error(`could not read the spam events: ${line('GET events', res)}`);
  const out = new Map<string, SpamEvent>();
  for (const row of rows as Array<{ id: string; request_id: unknown; user_id: unknown; properties: Record<string, unknown> }>) {
    out.set(row.id, {
      id: row.id,
      reason: String(row.properties['reason'] ?? ''),
      count: Number(row.properties['count'] ?? 0),
      keys: Object.keys(row.properties).sort(),
      raw: JSON.stringify(row),
      requestId: row.request_id,
      userId: row.user_id,
    });
  }
  return out;
}

/** How many refusals of `reason` were added between two reads, and which events carry them. */
export function spamDelta(before: Map<string, SpamEvent>, after: Map<string, SpamEvent>, reason: string): { total: number; changed: SpamEvent[] } {
  let total = 0;
  const changed: SpamEvent[] = [];
  for (const event of after.values()) {
    if (event.reason !== reason) continue;
    const added = event.count - (before.get(event.id)?.count ?? 0);
    if (added !== 0) {
      total += added;
      changed.push(event);
    }
  }
  return { total, changed };
}

/** Wait helper for the FR-8 time trap: a token is refused in its first 3 seconds. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const STAGING_ORIGIN = (): string => stagingUrl().origin;

/** A valid homeowner body. Every field can be overridden; `index` makes email and phone distinct. */
export function homeownerBody(name: string, index = 0, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const suffix = String(index % 100).padStart(2, '0');
  return {
    name,
    phone: `905-555-01${suffix}`,
    email: `qa-probe.${runId()}.${index}@example.com`,
    address: `${10 + index} Probe Street, Hamilton ON`,
    problem: `QA-PROBE ${runId()} request ${index}: the kitchen tap drips and the cabinet is wet`,
    urgency: 'flexible',
    website: '',
    ...extra,
  };
}
