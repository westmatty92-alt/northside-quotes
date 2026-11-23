'use client';

// SCR-03 Staff sign-in: email and password, one focal point (the teal "Sign in" button). No "Create account", no
// "Forgot password", no way to change or reset a password: none exists (NG-4, FR-27, AC-004.6, AC-004.10).
//
// Notices sit above the form, one at a time, and are said in the design's words:
//   401 invalid_credentials  "Email or password is incorrect" (the same for a wrong password and an unknown email)
//   429 sign_in_paused       "Too many sign-in attempts..." (one message for both limits; never says which applied)
//   503 sign_in_unavailable  "Sign-in is unavailable..." (the counters could not be read; no session started)
//   ?session=ended           "Your session ended. Your last change was not saved..." (info, until she tries again)
// A failed attempt keeps the email and clears the password. After a successful sign-in she goes to `next`, which the
// page has already passed through the allow-list (next-path.ts); anything else lands on /requests.
import { useRouter } from 'next/navigation';
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { staffCopy } from '@/components/staff/copy';
import { SignInPreviewContext } from '@/components/staff/sign-in-preview';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { type } from '@/components/ui/typography';
import { useSignIn } from '@/lib/api/generated/staff-auth/staff-auth';
import { isApiProblem } from '@/lib/api/fetcher';

type Notice = 'wrong' | 'paused' | 'unavailable' | 'failed';

interface SignInFormProps {
  /** Already checked against the allow-list by the page. */
  next: string;
  /** The session ended while she was working (`?session=ended`). */
  ended: boolean;
}

function noticeFor(error: unknown): Notice {
  if (isApiProblem(error)) {
    if (error.status === 401) return 'wrong';
    if (error.status === 429) return 'paused';
    if (error.status === 503) return 'unavailable';
  }
  return 'failed';
}

export function SignInForm({ next, ended }: SignInFormProps) {
  const router = useRouter();
  const preview = useContext(SignInPreviewContext);
  const [email, setEmail] = useState(preview?.email ?? '');
  const [password, setPassword] = useState(preview?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [done, setDone] = useState(false);
  const [missing, setMissing] = useState<{ email?: string; password?: string }>({});
  const banner = useRef<HTMLDivElement>(null);
  const mutation = useSignIn();
  const pending = mutation.isPending || done;

  function attempt(emailValue: string, passwordValue: string) {
    mutation.mutate(
      { data: { email: emailValue, password: passwordValue } },
      {
        onSuccess: () => {
          setDone(true); // the button stays paused while the next page loads
          router.replace(next);
          router.refresh();
        },
        onError: (error) => {
          setNotice(noticeFor(error));
          setPassword(''); // a failed attempt keeps the email and clears the password
        },
      },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // one press, one attempt
    const trimmed = email.trim();
    const problems = {
      ...(trimmed ? {} : { email: staffCopy.signIn.emailMissing }),
      ...(password ? {} : { password: staffCopy.signIn.passwordMissing }),
    };
    setMissing(problems);
    if (problems.email || problems.password) return;
    setNotice(null);
    attempt(trimmed, password);
  }

  // The mock scenarios that press "Sign in" once on load (src/mocks/**). Nothing provides a preview in a normal run.
  const fired = useRef(false);
  useEffect(() => {
    if (!preview?.autoSubmit || fired.current) return;
    fired.current = true;
    attempt(preview.email, preview.password);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per page load, from the scenario seed
  }, [preview]);

  // A new notice takes focus, so a keyboard or screen-reader user hears it at once.
  useEffect(() => {
    if (notice) banner.current?.focus();
  }, [notice]);

  const words = notice ? staffCopy.signIn[notice] : null;

  return (
    <div className="grid gap-lg">
      <div className="grid gap-sm">
        <h1 className={type.h1}>{staffCopy.signIn.title}</h1>
        <p className="text-text-secondary">{staffCopy.signIn.lede}</p>
      </div>

      {notice && words ? (
        <Banner
          ref={banner}
          variant={notice === 'wrong' || notice === 'failed' ? 'error' : 'warning'}
          icon={notice === 'paused' ? 'lock' : undefined}
          urgent
          titleId="sign-in-notice"
          title={words.title}
        >
          <p>{words.body}</p>
        </Banner>
      ) : ended ? (
        <Banner variant="info" titleId="sign-in-ended" title={staffCopy.signIn.ended.title}>
          <p>{staffCopy.signIn.ended.body}</p>
        </Banner>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="grid gap-lg">
        <Field id="email" label={staffCopy.signIn.email} error={missing.email}>
          {(aria) => (
            <Input
              {...aria}
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field id="password" label={staffCopy.signIn.password} error={missing.password}>
          {(aria) => (
            <div className="flex items-center gap-sm">
              <Input
                {...aria}
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="min-w-0 flex-1"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button aria-pressed={showPassword} aria-controls="password" onClick={() => setShowPassword((shown) => !shown)}>
                {staffCopy.signIn.show}
              </Button>
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" block paused={pending}>
          {pending ? staffCopy.signIn.submitting : staffCopy.signIn.submit}
        </Button>
      </form>

      <p className={type.hint}>{staffCopy.signIn.noSignUp}</p>
    </div>
  );
}
