import 'server-only';

// src/lib/server/integrations/ghl/log.ts: the runner's log line, allow-listed like docs/architecture.md
// "Observability". One JSON line per job outcome. Any field not listed here is dropped, so a name, phone, email,
// address, token, URL, provider body or error message cannot reach the log by accident.
//
// The backend lane owns `src/lib/server/log.ts` (BE1). Until it exists this local emitter writes the same fields;
// swapping it for the shared one is a one-line change in runner.ts.

export type GhlLogEntry = {
  level?: 'info' | 'warn' | 'error';
  /** What happened to the job in this run. */
  outcome?: string;
  /** One of the six metrics-spec error classes. */
  error_class?: string;
  /** The HTTP status GHL answered with, or the SQLSTATE of a database failure. */
  code?: string | number;
  job_id?: string;
  /** Attempt number of this try (attempt_count + 1). */
  attempt?: number;
  quote_request_id?: string;
};

const ALLOWED = ['level', 'outcome', 'error_class', 'code', 'job_id', 'attempt', 'quote_request_id'] as const;

export type GhlLogger = (entry: GhlLogEntry) => void;

export const logGhl: GhlLogger = (entry) => {
  const line: Record<string, unknown> = { route: 'ghl-sync' };
  const source = entry as Record<string, unknown>;
  for (const key of ALLOWED) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') line[key] = value;
  }
  if (line.level === undefined) line.level = 'info';
  const out = JSON.stringify(line);
  if (line.level === 'error') console.error(out);
  else if (line.level === 'warn') console.warn(out);
  else console.log(out);
};
