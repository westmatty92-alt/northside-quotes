// The environment Schemathesis (and every other Python process the fuzz starts) is allowed to see. SEC-25.
//
// Why this exists: Schemathesis pulls in ~54 transitive PyPI packages that are not hash-locked. Any one of them runs
// inside the child process, so the child must never hold a credential it does not need. The wrapper (run.mjs) mints
// the staff token and passes the token and the Vercel bypass header to Schemathesis as --header arguments, so none of
// the names in .env.local has to be in its environment at all.
//
// Rules
//   1. The child environment is built from this allow-list, never from `...process.env`.
//   2. .env.local is read in run.mjs only for the names the wrapper itself uses, and never reaches the child.
//   3. A guard refuses to start when a name outside the allow-list, or one that looks like a credential, is present.

/** Names copied from the parent environment when they are set. Nothing else gets through. */
export const ALLOWED_PARENT_NAMES = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];

/** Names the wrapper sets itself. */
export const FIXED_NAMES = { NO_COLOR: '1' };

/** A name matching this is a credential, whatever else is true. */
export const FORBIDDEN_NAME = /SERVICE|SECRET_KEY|DB_URL|LEDGER|PASSWORD/i;

/** The one credential-looking name that may appear (the Vercel protection-bypass setting). It is not in the allow-list
 *  today (the bypass goes to Schemathesis as a --header argument), so in practice it is absent too. */
export const BYPASS_NAME = 'VERCEL_AUTOMATION_BYPASS_SECRET';

export function buildChildEnv(parent) {
  const env = { ...FIXED_NAMES };
  for (const name of ALLOWED_PARENT_NAMES) {
    if (typeof parent[name] === 'string' && parent[name] !== '') env[name] = parent[name];
  }
  return env;
}

/** Names in `env` that must not reach a child: credential-looking ones (except the bypass name) and any name that is
 *  not in the allow-list. Returns names only, never values. */
export function offendingNames(env) {
  const allowed = new Set([...ALLOWED_PARENT_NAMES, ...Object.keys(FIXED_NAMES)]);
  return Object.keys(env).filter((name) => {
    if (name === BYPASS_NAME) return false;
    return FORBIDDEN_NAME.test(name) || !allowed.has(name);
  });
}
