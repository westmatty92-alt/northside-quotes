// @vitest-environment jsdom
// SCR-03: every notice the design names, in its words, and what sign-in does with `next`. API calls go through msw with the
// contract's statuses; the next router is the only stand-in.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignInPreviewContext } from '@/components/staff/sign-in-preview';
import { SignInForm } from '@/components/staff/sign-in-form';
import { expectNoAxeViolations } from '@/components/request/test-support';
import type { Problem, ProblemCode } from '@/lib/api/generated/model';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const attempts: { email: string; password: string }[] = [];

function problem(status: number, code: ProblemCode, title: string) {
  const body: Problem = { type: 'about:blank', title, status, code };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

function signInReturns(respond: () => Response | Promise<Response>) {
  attempts.length = 0;
  server.use(
    http.post('*/api/auth/sign-in', async ({ request }) => {
      attempts.push((await request.json()) as { email: string; password: string });
      return respond();
    }),
  );
}

const staff = () => HttpResponse.json({ user_id: '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19', display_name: 'Owner' });

function renderForm(props: { next?: string; ended?: boolean } = {}, preview?: { email: string; password: string; autoSubmit: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignInPreviewContext value={preview}>
        <SignInForm next={props.next ?? '/requests'} ended={props.ended ?? false} />
      </SignInPreviewContext>
    </QueryClientProvider>,
  );
}

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

const press = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

describe('SCR-03 Staff sign-in', () => {
  it('Empty: the blank form, a labelled email and password, and no sign-up, forgot-password or reset anywhere', async () => {
    const { container } = renderForm();
    expect(screen.getByRole('heading', { level: 1, name: 'Staff sign-in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).not.toMatch(/forgot|reset|create account|sign up\b/i);
    await expectNoAxeViolations(container);
  });

  it('Show reveals the password and hides it again', () => {
    renderForm();
    const show = screen.getByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(show);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(show).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(show);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('Success: signs in and goes to `next` (already checked against the allow-list by the page)', async () => {
    signInReturns(staff);
    renderForm({ next: '/pipeline' });
    fill('owner@example.com', 'correct-horse');
    press();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/pipeline'));
    expect(attempts).toEqual([{ email: 'owner@example.com', password: 'correct-horse' }]);
  });

  it('Loading: the button reads "Signing in" and is paused, so one press makes one attempt', async () => {
    let release: () => void = () => undefined;
    signInReturns(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(staff());
        }),
    );
    renderForm();
    fill('owner@example.com', 'correct-horse');
    press();
    const busy = await screen.findByRole('button', { name: 'Signing in' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(busy);
    fireEvent.submit(busy.closest('form') as HTMLFormElement);
    release();
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(attempts).toHaveLength(1);
  });

  it('Error 401: "Email or password is incorrect", email kept, password cleared, focus on the notice', async () => {
    signInReturns(() => problem(401, 'invalid_credentials', 'Email or password is incorrect'));
    const { container } = renderForm();
    fill('owner@example.com', 'wrong');
    press();
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Email or password is incorrect');
    expect(notice).toHaveTextContent('Your email is still filled in.');
    expect(screen.getByLabelText('Email')).toHaveValue('owner@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    await waitFor(() => expect(document.activeElement).toBe(notice));
    expect(nav.replace).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('Error 429: one message for both limits, in the design\'s words, and it never says which limit applied', async () => {
    signInReturns(() => problem(429, 'sign_in_paused', 'Too many sign-in attempts. Try again in a few minutes.'));
    const { container } = renderForm();
    fill('owner@example.com', 'correct-horse');
    press();
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Too many sign-in attempts. Try again in a few minutes.');
    expect(notice).toHaveTextContent('even with the right password');
    expect(notice.textContent).not.toMatch(/address|network|per[- ]email|minutes? for this email|no account/i);
    await expectNoAxeViolations(container);
  });

  it('Error 503 sign_in_unavailable: "Sign-in is unavailable. Try again in a few minutes." and no session starts', async () => {
    signInReturns(() => problem(503, 'sign_in_unavailable', 'Sign-in is unavailable. Try again in a few minutes.'));
    const { container } = renderForm();
    fill('owner@example.com', 'correct-horse');
    press();
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Sign-in is unavailable. Try again in a few minutes.');
    expect(notice).toHaveTextContent('Your password was not checked.');
    expect(nav.replace).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('Error with no answer from the server: a plain "Couldn\'t sign in" notice, values kept', async () => {
    signInReturns(() => HttpResponse.error());
    renderForm();
    fill('owner@example.com', 'correct-horse');
    press();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign in. Try again.");
    expect(screen.getByLabelText('Email')).toHaveValue('owner@example.com');
  });

  it('Session ended (?session=ended): an info notice in the design\'s words, until the next attempt says something else', async () => {
    signInReturns(() => problem(401, 'invalid_credentials', 'Email or password is incorrect'));
    const { container } = renderForm({ ended: true });
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Your session ended.');
    expect(notice).toHaveTextContent('Your last change was not saved. Sign in again, then check the request.');
    await expectNoAxeViolations(container);
    fill('owner@example.com', 'wrong');
    press();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.queryByText('Your session ended.')).toBeNull();
  });

  it('Empty fields: asks for each, next to the field, and makes no request', async () => {
    signInReturns(staff);
    const { container } = renderForm();
    press();
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(attempts).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('a mock scenario that presses "Sign in" once on load shows the refusal without a click', async () => {
    signInReturns(() => problem(429, 'sign_in_paused', 'Too many sign-in attempts. Try again in a few minutes.'));
    renderForm({}, { email: 'owner@example.com', password: 'correct-horse', autoSubmit: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts');
    expect(attempts).toHaveLength(1);
  });
});
