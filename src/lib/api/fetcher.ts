// src/lib/api/fetcher.ts: the Orval mutator (orval.config.ts `override.mutator`, name `apiFetch`). The one
// hand-written piece of the API layer (frontend lane).
//
// What it does for every generated call:
//   - sends the request to the URL the generated getter built (it already starts with the `/api` base path),
//   - keeps every header the caller gave it. The public form passes its token through the generated
//     `request: { headers: { 'X-Form-Token': ... } }` option; nothing here knows about tokens,
//   - resolves `{ data, status, headers }` for a 2xx, which is the shape the generated response types describe,
//   - throws an `ApiProblem` for EVERY non-2xx (problem+json or not), so callers branch on `status` and `code`
//     and never parse message text, and `ApiNetworkError` when no response arrived at all.
//
// Responses are checked against the operation's generated Zod schema by the caller (the mutator does not know which
// operation it is serving). Staff bearer tokens and the 401 `session_expired` sign-out are added by the staff-screens
// step (FE2); the public form needs neither.
import { z } from 'zod';
import { ProblemCode, type Problem } from '@/lib/api/generated/model';

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(ProblemCode),
  detail: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

/** Narrows an unknown response body to the contract's Problem, or null when it is not one. */
export function toProblem(body: unknown): Problem | null {
  const parsed = problemSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** A non-2xx answer. `problem` is the parsed problem+json body, or null (a 500 from a proxy, an HTML error page). */
export class ApiProblem extends Error {
  readonly status: number;
  /** The raw parsed body (JSON value or text), kept so callers can read fields the contract adds later. */
  readonly body: unknown;
  readonly headers: Headers;
  readonly problem: Problem | null;

  constructor(status: number, body: unknown, headers: Headers) {
    const problem = toProblem(body);
    super(problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiProblem';
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.problem = problem;
  }

  get code(): Problem['code'] | null {
    return this.problem?.code ?? null;
  }
}

/** The request never got an answer (offline, DNS, connection reset). */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('The request did not reach the server', { cause });
    this.name = 'ApiNetworkError';
  }
}

export function isApiProblem(error: unknown): error is ApiProblem {
  return error instanceof ApiProblem;
}

const NO_BODY_STATUSES: readonly number[] = [204, 205, 304];

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/problem+json');

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (cause) {
    // an aborted request is the caller's own doing; hand the abort back untouched
    if (options.signal?.aborted) throw cause;
    throw new ApiNetworkError(cause);
  }

  let data: unknown = null;
  if (!NO_BODY_STATUSES.includes(response.status)) {
    const text = await response.text();
    data = text;
    if (text && (response.headers.get('content-type') ?? '').includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
  }

  if (!response.ok) throw new ApiProblem(response.status, data, response.headers);

  // Orval's fetch client types this call as the operation's generated response union (`{ data, status, headers }`);
  // the mutator cannot name that union, so the one cast lives here and nowhere else.
  return { data, status: response.status, headers: response.headers } as T;
}
