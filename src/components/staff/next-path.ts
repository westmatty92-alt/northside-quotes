// Where a signed-in staff member goes after SCR-03 (FR-26, AC-004.3, AC-004.14), and the address that sends a
// signed-out one there. The rule is docs/SECURITY_MODEL.md invariant 22, written out the same way the backend's
// `safeNextPath` (src/lib/server/auth/next-path.ts, merged from the backend lane) writes it: `next` is followed only
// when it is /requests, /pipeline or one of their detail paths; anything else lands on /requests. This copy exists
// because that file is not in this lane yet; once both are merged, one can import the other.

/** Invariant 22: `^/(requests|pipeline)(/[0-9a-f-]{36})?$`. */
export const NEXT_ALLOW_LIST = /^\/(requests|pipeline)(\/[0-9a-f-]{36})?$/;

/** Where sign-in lands when there is no usable `next`. */
export const DEFAULT_LANDING = '/requests';

/** `next` when it passes the allow-list, otherwise /requests. Never throws. */
export function safeNextPath(next: string | null | undefined): string {
  return typeof next === 'string' && NEXT_ALLOW_LIST.test(next) ? next : DEFAULT_LANDING;
}

/**
 * The SCR-03 address after a session ended on `pathname` (a 401 from the API): the page she was on is remembered when
 * the allow-list admits it, and `session=ended` makes SCR-03 say "Your session ended".
 */
export function sessionEndedHref(pathname: string): string {
  const next = safeNextPath(pathname);
  return `/sign-in?next=${next}&session=ended`;
}
