// Black-box calls to the deployed API (docs/openapi.yaml), made from outside with a real session.
import fs from 'node:fs';
import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs } from '@playwright/test';
import { bypassHeaders, stagingUrl, statePath, type Role } from './env';

export type Status = 'new' | 'quoted' | 'won' | 'lost';

export interface ListItem {
  id: string;
  reference: string;
  name: string;
  urgency: string;
  status: Status;
  submitted_at: string;
  version: number;
}
export interface Detail extends ListItem {
  phone: string;
  email: string;
  address: string;
  problem: string;
  status_changed_at: string | null;
  price_cents: number | null;
  currency: string;
  note: string | null;
  photo_count: number;
  photos: Array<{ position: number; content_type: string; url: string | null; expires_at: string | null }>;
  last_updated: { by_display_name: string; at: string } | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  ghl: { copy: { state: string; at: string | null }; stage_tag: { state: string; at: string | null } | null };
}
export interface WeeklyCount {
  week_start: string;
  week_end: string;
  time_zone: string;
  requests: number;
  won: number;
  lost: number;
}

/** The staff access token from a saved signed-in session (the Supabase auth cookie, possibly in chunks). */
export function accessTokenFromState(role: Role): string {
  const state = JSON.parse(fs.readFileSync(statePath(role), 'utf8')) as { cookies: Array<{ name: string; value: string }> };
  const chunks = state.cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split('.')[1] ?? 0) - Number(b.name.split('.')[1] ?? 0));
  if (chunks.length === 0) throw new Error(`no Supabase auth cookie in the ${role} session (sign-in setup did not run?)`);
  let raw = decodeURIComponent(chunks.map((c) => c.value).join(''));
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8');
  const session = JSON.parse(raw) as { access_token?: string };
  if (!session.access_token) throw new Error(`the ${role} session holds no access token`);
  return session.access_token;
}

export async function newApi(playwright: PlaywrightWorkerArgs['playwright'], token?: string): Promise<APIRequestContext> {
  // Only the bypass header, to the preview host. Not x-vercel-set-bypass-cookie: that makes Vercel answer 307 first.
  const secret = bypassHeaders()['x-vercel-protection-bypass'];
  return playwright.request.newContext({
    baseURL: stagingUrl().origin,
    extraHTTPHeaders: { ...(secret ? { 'x-vercel-protection-bypass': secret } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  request_id?: string;
  errors?: Array<{ field: string; message: string }>;
}

/** What a failing call looked like, for the ticket: status, problem code, Vercel request id. */
export async function describe(res: APIResponse): Promise<string> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    body = '(unreadable)';
  }
  return `${res.status()} ${res.url().replace(stagingUrl().origin, '')} x-vercel-id=${res.headers()['x-vercel-id'] ?? 'n/a'} body=${body}`;
}

export class StaffApi {
  constructor(readonly request: APIRequestContext) {}

  async list(params: { status?: Status; limit?: number; cursor?: string } = {}): Promise<{ data: ListItem[]; next_cursor: string | null }> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    qs.set('limit', String(params.limit ?? 100));
    if (params.cursor) qs.set('cursor', params.cursor);
    const res = await this.request.get(`/api/quote-requests?${qs}`);
    if (!res.ok()) throw new Error(`list failed: ${await describe(res)}`);
    return (await res.json()) as { data: ListItem[]; next_cursor: string | null };
  }

  async get(id: string): Promise<Detail> {
    const res = await this.request.get(`/api/quote-requests/${id}`);
    if (!res.ok()) throw new Error(`get failed: ${await describe(res)}`);
    return (await res.json()) as Detail;
  }

  /** Requests created by this suite (name starts with the tag), newest first. */
  async tagged(prefix = 'QA-E2E'): Promise<ListItem[]> {
    const page = await this.list({ limit: 100 });
    return page.data.filter((r) => r.name.startsWith(prefix));
  }

  async byName(name: string): Promise<ListItem[]> {
    const page = await this.list({ limit: 100 });
    return page.data.filter((r) => r.name === name);
  }

  /** Move a request to a status whatever its current one is (used to set up board and list tests). */
  async setStatus(id: string, to: Status): Promise<Detail> {
    const current = await this.get(id);
    if (current.status === to) return current;
    const res = await this.request.post(`/api/quote-requests/${id}/status-changes`, { data: { to_status: to, version: current.version } });
    if (res.status() !== 201) throw new Error(`status change failed: ${await describe(res)}`);
    return this.get(id);
  }

  async saveQuote(id: string, body: { price_cents: number | null; note: string | null; version: number }): Promise<APIResponse> {
    return this.request.put(`/api/quote-requests/${id}/quote`, { data: body });
  }

  async weekly(): Promise<WeeklyCount> {
    const res = await this.request.get('/api/weekly-counts/current');
    if (!res.ok()) throw new Error(`weekly count failed: ${await describe(res)}`);
    return (await res.json()) as WeeklyCount;
  }
}

/** The form token the public page embeds: v1.<issued_at_ms>.<nonce uuid>.<signature>. */
const TOKEN_RE = /v1\.\d{13}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]+/;

export async function fetchPublicPage(anon: APIRequestContext): Promise<{ res: APIResponse; html: string; token: string | null }> {
  const res = await anon.get('/');
  const html = await res.text();
  return { res, html, token: html.match(TOKEN_RE)?.[0] ?? null };
}

export function nonceOf(token: string): string {
  return token.split('.')[2] ?? '';
}

export interface PublicSubmission {
  request_id: string;
  reference: string;
}

/**
 * The homeowner's two calls, made directly (no photos): GET / for a form token, wait out the 3 second time
 * trap, POST /api/quote-requests, then POST .../submission. The body is sent exactly as given, so a test can
 * leave a field out or send an odd value (AC-001.17). The caller takes a submission slot first.
 */
export async function submitDirect(anon: APIRequestContext, body: Record<string, unknown>): Promise<PublicSubmission> {
  const page = await fetchPublicPage(anon);
  if (!page.token) throw new Error(`no form token on GET /: ${await describe(page.res)}`);
  await new Promise((resolve) => setTimeout(resolve, 3_600)); // FR-8: a token is refused in its first 3 seconds
  const headers = { 'X-Form-Token': page.token };
  const created = await anon.post('/api/quote-requests', { headers, data: body });
  if (created.status() !== 201 && created.status() !== 200) throw new Error(`create failed: ${await describe(created)}`);
  const started = (await created.json()) as { request_id: string };
  const done = await anon.post(`/api/quote-requests/${started.request_id}/submission`, { headers });
  if (done.status() !== 200) throw new Error(`submission failed: ${await describe(done)}`);
  const result = (await done.json()) as { reference: string };
  return { request_id: started.request_id, reference: result.reference };
}
