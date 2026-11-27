import 'server-only';

// src/lib/server/log.ts: one JSON line per event, from an ALLOW-LIST of fields (docs/architecture.md "Observability",
// docs/SECURITY_MODEL.md invariant 11). Any other field a caller passes is dropped, and a value that does not look like
// the kind of value its field holds is dropped too, so personal data cannot ride along in a field that is allowed.
//
// Never pass an error object, an error's message, details or hint, a request body, a header or a URL here. For a failure
// give `error_class` (the kind of failure) and `code` (a SQLSTATE or a provider status): see errorFields() in http.ts.

type LogLevel = 'info' | 'warn' | 'error';

type FieldRule = { kind: 'string'; pattern: RegExp } | { kind: 'number' };

const ID = /^[A-Za-z0-9:._-]{1,100}$/;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

const RULES = {
  request_id: { kind: 'string', pattern: ID },
  route: { kind: 'string', pattern: /^[A-Za-z0-9 /_:.[\]{}-]{1,100}$/ }, // the route pattern, never the URL or query string
  method: { kind: 'string', pattern: /^[A-Z]{3,7}$/ },
  status: { kind: 'number' },
  duration_ms: { kind: 'number' },
  user_id: { kind: 'string', pattern: ID },
  quote_request_id: { kind: 'string', pattern: ID },
  outcome: { kind: 'string', pattern: TOKEN },
  error_class: { kind: 'string', pattern: TOKEN },
  code: { kind: 'string', pattern: TOKEN },
  job_id: { kind: 'string', pattern: ID },
  attempt: { kind: 'number' },
} satisfies Record<string, FieldRule>;

export type LogField = keyof typeof RULES;
export type LogFields = Partial<Record<LogField, string | number>>;

/** The log line for `fields` (exported for tests): allow-listed fields with well-formed values only. */
export function buildLogLine(level: LogLevel, fields: Record<string, unknown>): string {
  const line: Record<string, string | number> = { level };
  for (const name of Object.keys(RULES) as LogField[]) {
    const value = fields[name];
    const rule: FieldRule = RULES[name];
    if (rule.kind === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) line[name] = Math.round(value);
    } else if (typeof value === 'string' && rule.pattern.test(value)) {
      line[name] = value;
    }
  }
  return JSON.stringify(line);
}

/** Write one structured line to the function log (Vercel collects stdout and stderr). */
export function logLine(level: LogLevel, fields: LogFields): void {
  const text = buildLogLine(level, fields);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}
