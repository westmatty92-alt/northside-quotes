---
name: docs-evidence
description: bl-docs proof rule — every SOP step is backed by evidence from the build (verified ledger steps, shipped code, QA screenshots and reports, release and drill logs, the account-setup packet, runbooks), recorded in docs/sops/evidence.md. No evidence means the step is marked unverified or left out, never written as fact.
---

# Docs · Evidence

## 1. What counts as evidence
- A **verified** ledger step and its report (`.baseleap/reports/<STEP>.md`); code at the shipped commit (component labels, route names, error messages).
- QA's run report and screenshots (`docs/qa-reports/**`); Playwright traces.
- `docs/ops/**`: the account-setup packet, `pipeline-drills.md` (including failed attempts: they are the "if it goes wrong" section), the runbook.
- Release summaries and run links.
- Not evidence: the PRD or plan on its own, a skill's description, memory, another SOP.

## 2. Record it (`docs/sops/evidence.md`)
One section per SOP, slug = file name: each step number → its evidence (path, run id, step id, screenshot). Steps that share one source can share a line.

## 3. When evidence is missing
Write the step as `⚠ unverified: <the step> — would be verified by <what>` and count it in your report. Never fill the gap from a guess. If the missing piece is a product problem (no confirmation message, an unlabeled button), report it as a finding.

## 4. Re-check on change
When a later step changes a screen or command an SOP cites, the SOP is stale: the orchestrator routes it back to you; update the step, its evidence and the changelog.
