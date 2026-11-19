---
name: qa-e2e
description: End-to-end testing for bl-qa — Playwright specs in tests/e2e that walk real user journeys on the staging Vercel preview (never locally, never production), with per-role signed-in sessions, role-based locators, mobile/desktop/GHL-embed viewports, console-error and failed-request capture, axe, and traces/screenshots on failure. Use for every e2e row in the test plan.
---

# QA · End-to-End Flows

You test the deployed app the way a client's customer uses it: in a browser, on the real preview, signed in as a real role.

## 1. Where the tests run

- **Target:** the `staging` branch's Vercel preview URL, passed in as `BASE_URL`. Never a local dev server, never production. If `BASE_URL` is missing or is the production domain, the config refuses to run (`templates/playwright.config.ts`).
- **Preview protection:** Vercel previews are protected; the config sends the `x-vercel-protection-bypass` header from the `VERCEL_AUTOMATION_BYPASS_SECRET` env var (name only — the value is set by Matthew in CI).
- **Data:** the staging Supabase branch, seeded by the backend's `supabase/seed.sql`; your setup creates a fresh tenant per run (see `qa-regression`).

## 2. Signed-in sessions per role

A `setup` project signs in once per role (the test helper creates the users on the staging branch) and saves `storageState` to `.auth/<role>.json` (git-ignored). Specs pick a role with `test.use({ storageState: '.auth/customer.json' })`. Never sign in through the UI in every test, never hardcode tokens.

## 3. Writing a spec (`templates/flow.spec.ts`)

- **Name tests by AC id** exactly as the test plan: `test('AC-003.2 slot taken shows next 3 slots', …)`, tagged `@smoke` or `@regression`.
- **Locators by role and label** (`getByRole('button', { name: 'Book' })`, `getByLabel('Email')`), `getByTestId` only where there's no accessible name. Never CSS classes or nth-child — they break on restyles and hide accessibility bugs.
- **Web-first assertions** (`await expect(locator).toBeVisible()`), never fixed `waitForTimeout`.
- **Assert outcomes the user sees** and, where the AC says so, the data (via the API with the same session).
- One journey per test; tests don't depend on each other's order or data.

## 4. Every test also checks (the shared fixture)

- **When you adapt specs to a repo, keep this fixture.** Extend `templates/fixtures.ts`; never replace it with a fixture that drops the guard (QA3 on the sandbox did, and a planted `console.error` went unnoticed).
- **No console errors** and **no failed requests** (4xx/5xx other than ones the test expects) during the test — collected by the fixture in `templates/fixtures.ts` and failing the test with the list.
- **axe** on each screen the flow visits (0 violations at `wcag2a, wcag2aa`).
- On failure: screenshot, Playwright trace and the console/network log are kept (`trace: 'retain-on-failure'`), and any `request_id` from a problem+json response is captured for the bug ticket.

## 4a. Before you hand in

Run the repo's `npm run lint` and `npx tsc --noEmit` on your files: CI's `verify` lints `tests/` too and is a required check. The React hooks rule reads Playwright's fixture callback `use` as a React hook; name it `provide` (or similar) rather than switching the rule off. (Sandbox: QA5's fixture blocked a release PR.)

A green local run doesn't prove hosted behaviour: the local Supabase stack allows things hosted Supabase refuses (the REST root with the anon key, for one). The first staging run caught a health check that reported the database down everywhere except locally.

## 5. Viewports

Projects for **mobile** (390 × 844), **desktop** (1280 × 800) and, for screens whose access is `embed` in `user-flows.md`, **embed** (the page loaded inside an iframe at 400 px wide on a test host page, checking the `frame-ancestors` decision and `postMessage` events).

## 6. Black-box API tests live here too

API-level rows of the test plan go in `tests/e2e/api/*.spec.ts` using Playwright's `request` fixture against `BASE_URL/api/...` with a role's session. They test the **deployed** API from outside — independent of the backend's own in-process tests in `tests/api/`. Validate response bodies against the generated Zod schemas **with `.strict()`**, so an extra field fails and is named (without it, Zod strips unknown keys and the test passes). Also, for every write endpoint, a **round-trip** test: send every writable field with a distinct value and check the response *and* a fresh read return each one. In the sandbox drill, an endpoint that silently dropped a field and a response with an undocumented field both passed the whole suite until these existed.

## 7. Playwright MCP is for exploring, not evidence

Use the Playwright MCP (headless, isolated) to explore a screen, reproduce a failure or find a locator. Anything you conclude must end up as a scripted spec the ledger can re-run. A screenshot you looked at once is not evidence.

---
Sources (ideas adapted, text written for Baseleap): lackeyjb/playwright-skill (MIT — multi-viewport runs, screenshots, network interception), anthropics/skills `webapp-testing` (Apache-2.0 — reconnaissance-then-action, wait for network idle, capture failures; the ComposioHQ entry is a copy of this skill under the same licence. Its `with_server.py` boots a local server, which Baseleap doesn't use), microsoft/playwright-mcp (Apache-2.0 — accessibility-snapshot navigation, `--isolated`, `--headless`), obra/superpowers (MIT — role-based selectors, evidence before claims).

## Emails and messages: test inbox only
A test that checks an email or message ("exactly one confirmation email") uses a **test inbox** the project sets up for staging (a sink or catch-all mailbox, named in `infra/environments.json` by DevOps), never a real person's address. Assert on count, recipient, subject and the key link or text. If staging has no test inbox, the test is NOT ASSESSABLE and the plan says what DevOps must add; never send to a real address to make it pass. SMS is never sent in tests.
