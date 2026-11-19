---
name: qa-report
description: Bug triage and reporting for bl-qa — turn each failing test, fuzz finding or crossed boundary into one root-cause bug ticket (steps to reproduce, expected vs actual, console/network trace, request id, evidence paths, class and likely owner) in .baseleap/reports/<STEP>-errors.md, and write the pass/fail run report docs/qa-reports/latest-run.md against the test plan. Use at the end of every run.
---

# QA · Bug Tickets & Run Report

Your output is what the orchestrator routes. A precise ticket gets fixed on the first attempt; a vague one burns the 3-attempt budget.

## 1. One ticket per root cause (`templates/bug-ticket.md`)

Group failures that share a cause (the same 500 behind six tests is one ticket listing six tests). Each ticket has:

- **Title** — the root cause in one line if you know it, else the precise symptom (`POST /api/bookings returns 500 when notes is null`).
- **Severity** — Critical (crossed permission boundary, data loss, money wrong, smoke test failing) · Important (an AC fails) · Minor (edge with a workaround, cosmetic).
- **AC / test** — AC ids and the failing test names.
- **Steps to reproduce** — numbered, from a fresh tenant; or the exact request (Schemathesis's `curl`, with secrets replaced by `$VARS`).
- **Expected** (quote the AC or contract) vs **Actual** (what happened).
- **Evidence** — trace and screenshot paths, the console errors, the failing request/response (status, trimmed body), the `request_id` so the backend can find its log line.
- **Class hint + likely owner** — `ui` → frontend · `server` → backend · `contract` → whichever side diverged (or architect if the contract is wrong) · `test` → qa · `env` → devops · `spec` → pm. Say what points there (e.g. "the API response matches the contract; the screen ignores `next_slots`" → frontend).
- **Signature suggestion** — a one-line root-cause signature the orchestrator can pass to `stack-ledger fail`.

You **suggest**; the orchestrator decides the route (`stack-triage`). You never message developers directly and never fix product code.

## 2. Where it goes

- `.baseleap/reports/<STEP>-errors.md` — all tickets for this run, Critical first. This is what the orchestrator reads.
- `docs/qa-reports/latest-run.md` — the run report (`templates/latest-run.md`), overwritten each run; the previous one is kept as `docs/qa-reports/<date>-<step>.md`.

## 3. The run report

- Target URL + commit SHA tested, run type (smoke/full/targeted), duration.
- **Verdict:** PASS only if every AC test, permission probe and NFR check passes and there are no open fuzz findings or flaky tests. Anything else is FAIL, with counts.
- AC coverage table from the test plan (pass / fail / flaky / not covered).
- Permission matrix results, fuzz summary per role, NFR results.
- Quarantined tests (if any) and why.
- Tickets list with severity and suggested owner.

## 4. Trimming evidence

Keep what proves the bug and nothing else: the relevant 20–40 lines of a trace, not the whole log. **Never paste tokens, cookies, keys or personal data** — redact to `$VAR` or `<redacted>`.

---
Sources (ideas adapted, text written for Baseleap): mattpocock/skills `triage` (MIT — classify, verify, brief), VoltAgent `qa-expert` (MIT — expected vs actual, owner routing via the orchestrator, read-only on application code), obra/superpowers `systematic-debugging` (MIT — root cause, one signature per cause).
