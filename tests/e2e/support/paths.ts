// URL predicates for toHaveURL. Match the path only: a regex ending in /requests$ would also match
// "/sign-in?next=/requests", which is the page a signed-out visitor is sent to, not the Requests tab.
export const pathIs = (path: string) => (url: URL) => url.pathname === path;
export const pathMatches = (pattern: RegExp) => (url: URL) => pattern.test(url.pathname);
/** The sign-in page, asked to return to `next` afterwards (the tab address the visitor opened). */
export const signInReturningTo = (next: string) => (url: URL) => url.pathname === '/sign-in' && url.searchParams.get('next') === next;
