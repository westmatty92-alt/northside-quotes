// src/lib/api/fetcher.ts: the Orval mutator (orval.config.ts `override.mutator`, name `apiFetch`).
//
// MINIMAL PLACEHOLDER FROM THE A2 SCAFFOLD. THE FRONTEND LANE REPLACES IT (it owns this file):
// add the staff bearer token from the Supabase session, the X-Form-Token header for the public form,
// problem+json error handling and the 401 `session_expired` sign-out (docs/SECURITY_MODEL.md "API authentication").
//
// Orval's fetch client expects the mutator to resolve to `{ data, status, headers }`; the generated URL getters
// already include the `/api` base path.
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const body = [204, 205, 304].includes(response.status) ? null : await response.text();
  let data: unknown = body;
  if (body && (response.headers.get('content-type') ?? '').includes('json')) data = JSON.parse(body);
  return { data, status: response.status, headers: response.headers } as T;
}
