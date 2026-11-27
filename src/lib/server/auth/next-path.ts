// src/lib/server/auth/next-path.ts: where a signed-in staff member goes after sign-in (FR-26, AC-004.3, AC-004.14).
//
// The `next` value comes from the address bar, so it is untrusted. It is followed only when it matches the allow-list of
// docs/SECURITY_MODEL.md invariant 22, exactly as written there; anything else (absolute URLs, `//host`, `/%2F%2Fhost`,
// encoded slashes, query strings, other paths) lands on /requests. No server-only import and no secrets: the pure function
// can be shared with the sign-in page (the frontend lane decides whether to import it).

/** Invariant 22: `^/(requests|pipeline)(/[0-9a-f-]{36})?$`. */
export const NEXT_ALLOW_LIST = /^\/(requests|pipeline)(\/[0-9a-f-]{36})?$/;

/** Where sign-in lands when there is no usable `next`. */
export const DEFAULT_LANDING = '/requests';

/** `next` when it passes the allow-list, otherwise /requests. Never throws. */
export function safeNextPath(next: string | null | undefined): string {
  return typeof next === 'string' && NEXT_ALLOW_LIST.test(next) ? next : DEFAULT_LANDING;
}

/** The staff areas that need a session: /requests and /pipeline, their detail paths and anything below them. */
export function isStaffPagePath(pathname: string): boolean {
  return /^\/(requests|pipeline)(\/|$)/.test(pathname);
}

/** The `/sign-in?next=<path>` address for a signed-out visit. `/` stays readable; anything unusual is percent-encoded. */
export function signInAddress(pathname: string): string {
  return `/sign-in?next=${encodeURIComponent(pathname).replace(/%2F/g, '/')}`;
}
