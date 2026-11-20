import 'server-only';
import { z } from 'zod';
import {
  buildCreateContactBody,
  isContactId,
  STAGE_TAGS,
  BASE_TAG,
  toE164,
  type CopySource,
  type OwnedTag,
  type StageTag,
} from './mapping';

// src/lib/server/integrations/ghl/client.ts: the typed GoHighLevel client and the ONLY reader of
// GHL_PRIVATE_INTEGRATION_TOKEN (SECURITY_MODEL invariant 9). Exactly the four calls of invariant 10:
//   GET    /contacts/search/duplicate
//   POST   /contacts
//   POST   /contacts/{id}/tags
//   DELETE /contacts/{id}/tags
// Provider shapes stop here: callers get our own small types and a GhlError with one of the six error classes
// of the metrics spec. Nothing in this file logs, and no error carries a body, a URL, a header or the token.
//
// No retry loop in the client on purpose: retries belong to the jobs table (5 min, 1 h, 3 h, 6 h, 12 h, the
// contract's "Sync jobs"), and the 120-second lease is sized for three single-attempt 10-second calls. The
// circuit breaker of the generic int-providers pattern is the job backoff too: the contract keeps no
// provider_health table for this single-tenant app.

/** The API version header, in one place. Live behaviour unverified (contract "API version header"). */
export const GHL_API_VERSION = 'v3';
export const GHL_DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
export const GHL_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export type GhlErrorClass = 'timeout' | 'auth' | 'rate_limited' | 'server_error' | 'config_missing' | 'rejected';

/** Classes that never get better by waiting: finish_ghl_job fails the job at once for these. */
export const NON_RETRYABLE_CLASSES: readonly GhlErrorClass[] = ['auth', 'config_missing', 'rejected'];

export class GhlError extends Error {
  readonly errorClass: GhlErrorClass;
  /** HTTP status when GHL answered, for the `code` field of a log line. */
  readonly status: number | undefined;
  /** For an unusable reply: the path of the field that was missing or of the wrong type, e.g. `contact.id`. */
  readonly drift: string | undefined;

  constructor(errorClass: GhlErrorClass, details: { status?: number; drift?: string } = {}) {
    // The message is the class only: never provider text, never a URL, never a value.
    super(`GoHighLevel call failed: ${errorClass}`);
    this.name = 'GhlError';
    this.errorClass = errorClass;
    this.status = details.status;
    this.drift = details.drift;
  }
}

type Env = Record<string, string | undefined>;

export type GhlClientOptions = {
  /** Defaults to process.env, read on every call so `next build` and tests need no values. */
  env?: Env;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type ContactCreateInput = CopySource & { tags: OwnedTag[] };

export type GhlClient = {
  /** The contact GHL already holds for this email or phone, or null (`contact: null` in the reply). */
  findDuplicateContact(input: { email: string; phone: string }): Promise<{ id: string } | null>;
  /** Creates a contact with the mapped fields and the given tags. */
  createContact(input: ContactCreateInput): Promise<{ id: string }>;
  /** Adds tags. A tag that does not exist yet is created by GHL (to confirm live). */
  addTags(contactId: string, tags: readonly OwnedTag[]): Promise<void>;
  /** Removes tags. Only the four stage tags can be passed: the app never removes any other tag. */
  removeTags(contactId: string, tags: readonly StageTag[]): Promise<void>;
};

type Config = { token: string; locationId: string; baseUrl: string };

function resolveConfig(env: Env): Config {
  const token = env.GHL_PRIVATE_INTEGRATION_TOKEN;
  // Printable ASCII only: anything else cannot be a header value, and must not reach fetch.
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new GhlError('config_missing');

  const locationId = env.GHL_LOCATION_ID;
  if (typeof locationId !== 'string' || !isContactId(locationId)) throw new GhlError('config_missing');

  return { token, locationId, baseUrl: resolveBaseUrl(env) };
}

/** S0 SEC-20: in production the override is ignored, so a wrong variable can never send the token elsewhere. */
export function resolveBaseUrl(env: Env): string {
  if (env.VERCEL_ENV === 'production') return GHL_DEFAULT_BASE_URL;
  const override = env.GHL_API_BASE_URL?.trim();
  if (!override) return GHL_DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    // Fail closed: an unusable override never falls back to the real host by surprise.
    throw new GhlError('config_missing');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new GhlError('config_missing');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function classifyStatus(status: number): GhlErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 404 || status === 422) return 'rejected';
  // 5xx, and any other status the contract does not name, is "a reply the app cannot use": retried, bounded by attempts.
  return 'server_error';
}

const isStageTag = (tag: string): tag is StageTag => (STAGE_TAGS as readonly string[]).includes(tag);

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// Reply schemas: only the fields we use. A missing or renamed field is drift, named in GhlError.drift.
const DuplicateReply = z.object({ contact: z.object({ id: z.string() }).nullable() });
const CreateReply = z.object({ contact: z.object({ id: z.string() }) });
const AnyReply = z.unknown();

export function createGhlClient(options: GhlClientOptions = {}): GhlClient {
  const timeoutMs = options.timeoutMs ?? GHL_TIMEOUT_MS;

  async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    input: { query?: Record<string, string>; body?: unknown },
    schema: z.ZodType<T>,
  ): Promise<T> {
    const config = resolveConfig(options.env ?? process.env);
    const doFetch = options.fetch ?? fetch;

    const url = new URL(`${config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);

    let res: Response;
    let text: string;
    try {
      res = await doFetch(url, {
        method,
        // A redirect would carry the request to another host: refuse it (fails as server_error).
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${config.token}`,
          Version: GHL_API_VERSION,
          Accept: 'application/json',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new GhlError(classifyStatus(res.status), { status: res.status });
      }
      text = await res.text();
    } catch (error) {
      if (error instanceof GhlError) throw error;
      throw new GhlError(isTimeout(error) ? 'timeout' : 'server_error');
    }

    if (text.length > MAX_RESPONSE_BYTES) throw new GhlError('server_error', { status: res.status, drift: 'body' });
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      throw new GhlError('server_error', { status: res.status, drift: 'body' });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const path0 = parsed.error.issues[0]?.path.map(String).join('.') || 'body';
      throw new GhlError('server_error', { status: res.status, drift: path0 });
    }
    return parsed.data;
  }

  const requireContactId = (id: string): string => {
    // SEC-12: checked before anything is sent; the attempt fails as server_error (contract "Field mapping").
    if (!isContactId(id)) throw new GhlError('server_error', { drift: 'contact id' });
    return id;
  };

  const requireReplyId = (id: string): string => {
    if (!isContactId(id)) throw new GhlError('server_error', { drift: 'contact.id' });
    return id;
  };

  return {
    async findDuplicateContact({ email, phone }) {
      const number = toE164(phone);
      if (number === null) throw new GhlError('rejected', { drift: 'phone' });
      const { locationId } = resolveConfig(options.env ?? process.env);
      const reply = await call('GET', '/contacts/search/duplicate', { query: { locationId, email, number } }, DuplicateReply);
      return reply.contact === null ? null : { id: requireReplyId(reply.contact.id) };
    },

    async createContact(input) {
      const { locationId } = resolveConfig(options.env ?? process.env);
      const body = buildCreateContactBody(locationId, input, input.tags);
      if (body === null) throw new GhlError('rejected', { drift: 'phone' });
      const reply = await call('POST', '/contacts', { body }, CreateReply);
      return { id: requireReplyId(reply.contact.id) };
    },

    async addTags(contactId, tags) {
      const id = requireContactId(contactId);
      for (const tag of tags) {
        if (tag !== BASE_TAG && !isStageTag(tag)) throw new GhlError('rejected', { drift: 'tag' });
      }
      await call('POST', `/contacts/${encodeURIComponent(id)}/tags`, { body: { tags: [...tags] } }, AnyReply);
    },

    async removeTags(contactId, tags) {
      const id = requireContactId(contactId);
      // AC-017.8: only the four stage tags are ever removed, never `quote-request` and never an owner's own tag.
      for (const tag of tags) {
        if (!isStageTag(tag)) throw new GhlError('rejected', { drift: 'tag' });
      }
      await call('DELETE', `/contacts/${encodeURIComponent(id)}/tags`, { body: { tags: [...tags] } }, AnyReply);
    },
  };
}
