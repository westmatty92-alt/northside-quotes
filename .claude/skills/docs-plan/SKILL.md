---
name: docs-plan
description: bl-docs design-phase step — from the PRD and blueprint, list every procedure this build creates or changes, who runs it, its SOP kind (1–5) and home, and what evidence will back it. Output docs/sops/plan.md for the Gate 2 brief.
---

# Docs · SOP plan

## 1. Find the procedures
Read the PRD (user stories, roles, admin tasks), `docs/design-specs.md` (screens and flows), the build plan (which steps change what) and `docs/ops/` (account setup, releases). A **procedure** is anything a person does on purpose, in order, with this system: an operator task ("approve a release", "add a staff member"), a recurring job ("month-end export"), a recovery ("restore after a failed sync"), an install.
Skip what the screen already makes obvious; an SOP earns its place when a wrong step costs time, money or data.

## 2. One row per procedure (`templates/sop-plan.md`)
| Procedure | Who runs it | Kind (1–5) | Home | New or change | Evidence expected |
- **Kind:** 1 company · 2 operator · 3 install/redeploy · 4 agent (kit; index only) · 5 client staff.
- **Home:** the file path under `docs/sops/<kind>/` and where it publishes (hub page, client docs).
- **Evidence expected:** which steps, files or runs will prove it (e.g. "FE3 verified screens + QA screenshots", "release run + drill log").

## 3. Flag what can't be documented yet
A procedure that depends on something not built (a manual step the PRD leaves open, a setting nobody owns) goes in "Open questions" at the bottom, for Gate 2.
