import 'server-only';

// src/lib/server/http.ts: wraps every route handler (docs/SECURITY_MODEL.md invariant 11, docs/architecture.md "HTTP plumbing").
//
//   - every error becomes application/problem+json built from OUR text (never a database, storage or provider message);
//   - PostgREST errors map by SQLSTATE: PT401 -> 401, PT404 -> 404, PT409 -> 409, PT422 -> 422, 23514 -> 422 with our own
//     field message (the failing row, which holds personal data, is never read), unreachable database -> 503, rest -> 500;
//   - anything unhandled is caught here and logged as { error_class, code } only, so Next.js never prints a raw error;
//   - one structured log line per request (log.ts allow-list) and an `x-request-id` header on every response;
//   - 405 handlers with a problem body (contract: a method that is not listed returns 405, code method_not_allowed).
import { randomUUID } from 'node:crypto';
import type { Problem, ProblemCode } from '@/lib/api/generated/model';
import { EnvConfigError } from './env';
import { logLine } from './log';

export type FieldError = { field: string; message: string };

const PUBLIC_FAILURE = "We couldn't send your request. Please try again.";

/** The title of each problem (our own text; the frontend branches on status and code, never on this). */
const TITLES: Record<ProblemCode, string> = {
  bad_request: 'Bad request',
  validation_failed: 'Some answers need fixing',
  submission_refused: PUBLIC_FAILURE,
  form_expired: PUBLIC_FAILURE,
  form_already_used: PUBLIC_FAILURE,
  form_token_invalid: PUBLIC_FAILURE,
  rate_limited: 'Too many requests. Please try again in a few minutes.',
  unauthorized: 'Unauthorized',
  session_expired: 'Your session ended.',
  invalid_credentials: 'Email or password is incorrect',
  sign_in_paused: 'Too many sign-in attempts. Try again in a few minutes.',
  sign_in_unavailable: 'Sign-in is unavailable. Try again in a few minutes.',
  not_found: 'Not found',
  stale_version: 'This request was changed by someone else. Reload to see the latest.',
  not_retryable: 'This copy cannot be retried.',
  photo_missing: 'A photo could not be used',
  photo_invalid: 'A photo could not be used',
  method_not_allowed: 'Method not allowed',
  service_unavailable: PUBLIC_FAILURE,
  internal_error: 'Something went wrong',
};

type ProblemOptions = {
  errors?: FieldError[];
  headers?: Record<string, string>;
  /** For the log line only: the kind of failure and its SQLSTATE or status. */
  errorClass?: string;
  logCode?: string;
};

/** A failure with a known answer. Thrown by services, mapped to a problem response by withApi. */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string>;
  readonly errorClass: string | undefined;
  readonly logCode: string | undefined;
  constructor(status: number, code: ProblemCode, options: ProblemOptions = {}) {
    super(code); // the message is the code: nothing sensitive can ever be in it
    this.name = 'ProblemError';
    this.status = status;
    this.code = code;
    this.errors = options.errors;
    this.headers = options.headers ?? {};
    this.errorClass = options.errorClass;
    this.logCode = options.logCode;
  }
}

export type ApiContext = { requestId: string; route: string };

const HEADERS = { 'Cache-Control': 'no-store' } as const;

/** A JSON success response. */
export function json(ctx: ApiContext, body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-request-id': ctx.requestId, ...headers },
  });
}

/** A problem+json response. No `request_id` in the body: the header carries it (and refusal bodies must stay identical). */
export function problemResponse(problem: ProblemError, ctx: ApiContext): Response {
  const body: Problem = {
    type: 'about:blank',
    title: TITLES[problem.code],
    status: problem.status,
    code: problem.code,
  };
  if (problem.errors !== undefined) body.errors = problem.errors;
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { ...HEADERS, 'Content-Type': 'application/problem+json', 'x-request-id': ctx.requestId, ...problem.headers },
  });
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** { error_class, code } of any thrown value: the kind of failure and its SQLSTATE or status, never message, details or hint. */
export function errorFields(error: unknown): { error_class: string; code: string } {
  if (error instanceof ProblemError) return { error_class: error.errorClass ?? 'problem', code: error.logCode ?? error.code };
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return {
    error_class: SAFE_TOKEN.test(name) ? name : 'unknown',
    code: typeof code === 'string' && SAFE_TOKEN.test(code) ? code : 'none',
  };
}

// ---- PostgREST error mapping ------------------------------------------------------------------------------------------

/** What PostgREST (supabase-js) hands back as `error`. Only `code` is ever used for a decision or a log line. */
export type DbError = { code?: string | null; message?: string | null };

/** { error_class, code } for a PostgREST error: the SQLSTATE only, never message, details or hint. */
export function dbErrorFields(error: DbError): { error_class: string; code: string } {
  return { error_class: 'postgrest', code: typeof error.code === 'string' && error.code !== '' ? error.code : 'none' };
}

/** Postgres check constraint -> the contract field it protects. The constraint name is read only to pick the field. */
const CHECK_FIELDS: Record<string, string> = {
  quote_requests_name_check: 'name',
  quote_requests_phone_check: 'phone',
  quote_requests_email_check: 'email',
  quote_requests_address_check: 'address',
  quote_requests_problem_check: 'problem',
  quote_requests_urgency_check: 'urgency',
};

const FIELD_MESSAGES: Record<string, string> = {
  name: 'Enter your name (2 to 100 characters)',
  phone: 'Enter a 10-digit phone number',
  email: 'Enter a valid email address',
  address: 'Enter the address (5 to 200 characters)',
  problem: 'Describe the problem in 10 to 2,000 characters',
  urgency: 'Choose how urgent it is',
};

export function fieldMessage(field: string): string | undefined {
  return FIELD_MESSAGES[field];
}

function checkViolationErrors(error: DbError): FieldError[] | undefined {
  const match = /violates check constraint "([A-Za-z0-9_]+)"/.exec(typeof error.message === 'string' ? error.message : '');
  const field = match?.[1] === undefined ? undefined : CHECK_FIELDS[match[1]];
  const message = field === undefined ? undefined : FIELD_MESSAGES[field];
  return field !== undefined && message !== undefined ? [{ field, message }] : undefined;
}

/** SQLSTATE or PostgREST codes that mean "the database could not be reached or is overloaded". supabase-js gives code '' for a network failure. */
function isUnreachable(code: string): boolean {
  return code === '' || /^(08|53|57)/.test(code) || /^PGRST00[0-3]$/.test(code);
}

/** The problem for a failed database call. Logs nothing itself: withApi logs the { error_class, code } this carries. */
export function dbProblem(error: DbError): ProblemError {
  const code = typeof error.code === 'string' ? error.code : '';
  const log = { errorClass: 'postgrest', logCode: code === '' ? 'none' : code };
  switch (code) {
    case 'PT401':
      return new ProblemError(401, 'session_expired', log);
    case 'PT404':
      return new ProblemError(404, 'not_found', log);
    case 'PT409':
      return new ProblemError(409, 'stale_version', log);
    case 'PT422':
      return new ProblemError(422, 'validation_failed', log);
    case '23514': {
      const errors = checkViolationErrors(error);
      return new ProblemError(422, 'validation_failed', errors === undefined ? log : { ...log, errors });
    }
    default:
      return isUnreachable(code) ? new ProblemError(503, 'service_unavailable', log) : new ProblemError(500, 'internal_error', log);
  }
}

/** A failed or unreachable dependency other than the database (Storage). `code` is a status or short word, never a message. */
export function unavailable(errorClass: string, code = 'none'): ProblemError {
  return new ProblemError(503, 'service_unavailable', { errorClass, logCode: code });
}

/** Anything thrown to the wrapper, as the problem to answer with. */
function toProblem(error: unknown): ProblemError {
  if (error instanceof ProblemError) return error;
  if (error instanceof EnvConfigError) {
    return new ProblemError(503, 'service_unavailable', { errorClass: 'EnvConfigError', logCode: error.variable });
  }
  const { error_class, code } = errorFields(error);
  return new ProblemError(500, 'internal_error', { errorClass: error_class, logCode: code });
}

// ---- the wrapper -----------------------------------------------------------------------------------------------------

const REQUEST_ID = /^[A-Za-z0-9:._-]{1,100}$/;

function requestIdOf(req: Request): string {
  const platform = req.headers.get('x-vercel-id');
  return platform !== null && REQUEST_ID.test(platform) ? platform : randomUUID();
}

/**
 * Wrap a route handler. `route` is the route pattern for the log line (e.g. 'POST /api/quote-requests'), never the URL.
 * The handler returns a Response (use json()) or throws a ProblemError; anything else it throws is a 500 with no detail.
 */
export function withApi<C = unknown>(
  route: string,
  handler: (req: Request, ctx: ApiContext, routeCtx: C) => Promise<Response>,
): (req: Request, routeCtx: C) => Promise<Response> {
  return async (req, routeCtx) => {
    const started = performance.now();
    const ctx: ApiContext = { requestId: requestIdOf(req), route };
    let response: Response;
    let outcome = 'ok';
    let failure: { error_class: string; code: string } | undefined;
    try {
      response = await handler(req, ctx, routeCtx);
    } catch (error) {
      const problem = toProblem(error);
      outcome = problem.code;
      failure = errorFields(problem);
      response = problemResponse(problem, ctx);
    }
    const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';
    logLine(level, {
      request_id: ctx.requestId,
      route,
      method: req.method,
      status: response.status,
      duration_ms: performance.now() - started,
      outcome,
      ...failure,
    });
    return response;
  };
}

/** A handler for a method the contract does not list for this path: 405 with an Allow header and a problem body. */
export function methodNotAllowed(route: string, allow: readonly string[]): (req: Request, routeCtx: unknown) => Promise<Response> {
  return withApi(route, () =>
    Promise.reject(new ProblemError(405, 'method_not_allowed', { headers: { Allow: allow.join(', ') } })),
  );
}

// ---- request bodies ---------------------------------------------------------------------------------------------------

/** Returned by readJsonBody when the body is not JSON or is too large; the service answers it with 400 bad_request. */
export const UNPARSEABLE = Symbol('unparseable-body');

const MAX_BODY_BYTES = 64 * 1024;

/** The JSON body, or UNPARSEABLE (not JSON, empty, or over 64 KB). Never throws. */
export async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return UNPARSEABLE;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return UNPARSEABLE;
    return JSON.parse(text) as unknown;
  } catch {
    return UNPARSEABLE;
  }
}
