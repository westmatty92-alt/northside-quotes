---
name: docs-sop
description: bl-docs verify-phase writing — one procedure per file from templates/sop.md, in plain words a non-developer can follow cold; numbered steps, one action each, exact names and direct links, what you should see, what to do when it goes wrong; changelog entry for every change. Operator Console entries use templates/operator-entry.md.
---

# Docs · Writing an SOP

## 1. Shape (`templates/sop.md`)
Title (verb + object: "Approve a production release") · Purpose (one sentence: the outcome) · Who · When · Before you start (access, accounts, what must already be true) · Steps · What you should see · If it goes wrong · Changelog.

## 2. Steps
- **Numbered, one action per step.** "Click **Review deployments**." not "Review and approve the deployment in GitHub."
- **Exact names** in bold, as they appear on screen, and a **direct link** wherever one exists. Never guess a button name or menu path: if the evidence doesn't show it, mark the step `⚠ unverified:`.
- **Say what the person should see** after anything that can fail ("the run turns green", "the page shows Saved").
- **Values:** name the setting, never its value. Secrets are copied tab to tab, never written down.
- **Branches** ("if the page shows Upgrade, stop") go inline under the step they belong to.
- Short sentences (under 25 words), plain words, second person, present tense.

## 3. If it goes wrong
The two or three failures the evidence actually showed (failed drill attempts, QA bugs, runbook incidents), each with what the person sees and what to do. Link the runbook for anything deeper.

## 4. Changelog (every SOP and `docs/sops/changelog.md`)
`YYYY-MM-DD — what changed — why (step or run that changed it)`, newest first. A change to a procedure updates the SOP **and** adds a changelog line; Gate 3 reads `docs/sops/changelog.md`.

## 5. Operator SOPs for the Baseleap Console
Console features follow Matthew's standing rule (Console Operator SOP, July 5 2026): each feature closes with an entry from `templates/operator-entry.md` ("Update — <date>: <feature>" · applies to · what changed for you · one-time setup · changelog).
