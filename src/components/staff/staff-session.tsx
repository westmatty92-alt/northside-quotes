'use client';

// The staff session on the client: the bearer token every staff API call carries, sign-out, and what happens when the
// API says the session is over.
//
// Token. Staff operations take the Supabase access token as `Authorization: Bearer <token>` (never the cookie,
// docs/openapi.yaml). The generated hooks take a `request` option; the one handed out here reads the CURRENT token
// every time a call is made (a refreshed token is picked up without any component re-rendering). In mock mode there is
// no session, so the option is empty and nothing else changes: turning mocking off is the only difference.
//
// A session that ended (401 on any staff call): `supabase.auth.signOut()` finishes FIRST, then the page goes to
// /sign-in?next=<path>&session=ended. Navigating before the cookies are cleared would make the proxy think she is
// still signed in and bounce her back (AC-004.7).
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigateTo } from '@/components/staff/navigation';
import { sessionEndedHref } from '@/components/staff/next-path';
import { Cell } from '@/hooks/cell';
import { getSessionClient } from '@/lib/supabase/browser';

export interface StaffSession {
  /** True when the screens run against the mock API (no real session exists). */
  mocking: boolean;
  /** Pass as the generated hooks' `request` option. Carries the staff bearer token. */
  request: RequestInit;
  /** The user's own sign-out: ends the Supabase session, clears every cached answer, goes to SCR-03. */
  signOut: () => Promise<void>;
  /** The API said 401: sign out, then SCR-03 with the "session ended" notice. Safe to call more than once. */
  endSession: () => Promise<void>;
}

const StaffSessionContext = createContext<StaffSession | null>(null);

export function useStaffSession(): StaffSession {
  const value = useContext(StaffSessionContext);
  if (!value) throw new Error('useStaffSession must be used inside StaffSessionProvider');
  return value;
}

/**
 * A `RequestInit` whose Authorization header is read when the request is made, not when the hook was written.
 * (Both the generated fetchers and apiFetch read `headers` at call time.)
 */
export function createAuthRequest(readToken: () => string | null): RequestInit {
  const headers: Record<string, string> = {};
  Object.defineProperty(headers, 'Authorization', {
    enumerable: true,
    get: () => {
      const token = readToken();
      return token ? `Bearer ${token}` : '';
    },
  });
  return { headers };
}

interface ProviderProps {
  mocking: boolean;
  /** Receives `endSession` so the query client (created before this provider) can call it on a 401. */
  registerEndSession?: (endSession: () => Promise<void>) => void;
  children: ReactNode;
}

export function StaffSessionProvider({ mocking, registerEndSession, children }: ProviderProps) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [token] = useState(() => new Cell<string | null>(null));
  const [ending] = useState(() => new Cell(false));
  const [where] = useState(() => new Cell(pathname));
  const [ready, setReady] = useState(mocking);

  useEffect(() => {
    where.set(pathname);
  }, [where, pathname]);

  // Real mode: load the session once before any staff call is made, then follow token refreshes.
  useEffect(() => {
    if (mocking) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    try {
      const auth = getSessionClient().auth;
      auth
        .getSession()
        .then(({ data }) => {
          token.set(data.session?.access_token ?? null);
        })
        .catch(() => {
          token.set(null); // no session: the first call answers 401 and the session-ended flow takes over
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
      const { data } = auth.onAuthStateChange((_event, session) => {
        token.set(session?.access_token ?? null);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // The browser client could not be made (public Supabase settings missing): carry on without a token.
      queueMicrotask(() => {
        if (!cancelled) setReady(true);
      });
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [mocking, token]);

  const request = useMemo<RequestInit>(
    () => (mocking ? {} : createAuthRequest(() => token.get())),
    [mocking, token],
  );

  const leave = useCallback(
    async (href: (path: string) => string) => {
      if (!mocking) {
        try {
          // 'local': this session only, and no dependence on the network answering for the cookies to be cleared
          await getSessionClient().auth.signOut({ scope: 'local' });
        } catch {
          // The cookies are cleared by supabase-js before it reports a failure; carry on to SCR-03.
        }
      }
      token.set(null);
      queryClient.clear(); // private data must not outlive the session (shared browsers)
      navigateTo(href(where.get()));
    },
    [mocking, queryClient, token, where],
  );

  const endSession = useCallback(async () => {
    if (ending.get()) return;
    ending.set(true);
    await leave(sessionEndedHref);
  }, [leave, ending]);

  const signOut = useCallback(async () => {
    if (ending.get()) return;
    ending.set(true);
    await leave(() => '/sign-in');
  }, [leave, ending]);

  useEffect(() => {
    registerEndSession?.(endSession);
  }, [registerEndSession, endSession]);

  const value = useMemo<StaffSession>(
    () => ({ mocking, request, signOut, endSession }),
    [mocking, request, signOut, endSession],
  );

  return <StaffSessionContext value={value}>{ready ? children : null}</StaffSessionContext>;
}
