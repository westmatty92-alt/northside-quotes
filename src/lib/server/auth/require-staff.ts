import 'server-only';

// src/lib/server/auth/require-staff.ts: the guard every staff route calls first (SECURITY_MODEL invariant 3 and
// "API authentication"; contract components.responses.Unauthorized).
//
//   - The caller is authenticated from the `Authorization: Bearer <access token>` header ONLY, never from cookies, so /api
//     has no CSRF surface.
//   - The token is verified by Supabase Auth (`auth.getUser(token)`), never just decoded.
//   - public.current_staff() under that token must return a row. It is empty for a user with no staff row and for a session
//     older than 7 days (app_private.is_staff), so a removed or expired staff member is locked out at once.
//   - Anything that is not a valid staff session is ONE answer, 401 session_expired (the frontend signs out and opens SCR-03).
//     Which of the reasons applied is only in the log line's { error_class }.
//   - Supabase unreachable is not "signed out": it is a 500 internal_error (the staff operations list no 503), so a short
//     outage does not sign the owner out of the screen she is working on.
//
// The returned `db` is the user-scoped client for this token, so every query the route makes runs under RLS as this user.
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { ProblemError } from '@/lib/server/http';
import { createUserClient } from '@/lib/server/supabase';
import type { Database } from '@/types/database';

export type StaffCaller = {
  userId: string;
  displayName: string;
  accessToken: string;
  /** The user-scoped client (RLS applies). */
  db: SupabaseClient<Database>;
};

/** Base64url characters, dots and padding: the shape of a JWT. Anything else is not worth sending to Auth. */
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]+)$/;
const MAX_TOKEN_LENGTH = 4096;

const sessionEnded = (reason: string) => new ProblemError(401, 'session_expired', { errorClass: reason, logCode: 'none' });
const upstream = (errorClass: string, logCode: string) => new ProblemError(500, 'internal_error', { errorClass, logCode });

/** PostgREST's answers for a token it rejects (PGRST301 to PGRST303), which arrive with HTTP 401. */
const JWT_REJECTED = /^PGRST30[1-3]$/;

export async function requireStaff(req: Request): Promise<StaffCaller> {
  const header = req.headers.get('authorization');
  const token = header === null ? undefined : BEARER.exec(header)?.[1];
  if (token === undefined || token.length > MAX_TOKEN_LENGTH) throw sessionEnded('no_bearer_token');

  const db = createUserClient(token);

  let user;
  try {
    const result = await db.auth.getUser(token);
    if (result.error) {
      const status = typeof result.error.status === 'number' ? result.error.status : 0;
      if (isAuthRetryableFetchError(result.error) || status === 0 || status >= 500) {
        throw upstream(result.error.name, String(status));
      }
      throw sessionEnded('token_rejected');
    }
    user = result.data.user;
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    throw upstream(error instanceof Error ? error.name : 'unknown', 'none');
  }
  if (!user) throw sessionEnded('token_rejected');

  let staff;
  try {
    staff = await db.rpc('current_staff');
  } catch (error) {
    throw upstream(error instanceof Error ? error.name : 'unknown', 'none');
  }
  if (staff.error) {
    const code = typeof staff.error.code === 'string' ? staff.error.code : '';
    if (staff.status === 401 || JWT_REJECTED.test(code)) throw sessionEnded('token_rejected');
    throw upstream('postgrest', code === '' ? 'none' : code);
  }
  const row = staff.data?.[0];
  if (!row) throw sessionEnded('not_staff_or_expired');
  return { userId: row.user_id, displayName: row.display_name, accessToken: token, db };
}
