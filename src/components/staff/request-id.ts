// The `request_id` of a detail address is untrusted (it is typed in the address bar) and is placed into an API path, so
// it must be one path segment of plain characters: letters, digits and hyphens, up to 64. A uuid passes, and so do the
// mock ids `mock-1` and `mock-2`; `a/../b`, `%2F` and anything else is a 404 page. The API answers 404 for an id it does
// not know.
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isRequestIdParam(value: string): boolean {
  return REQUEST_ID.test(value);
}
