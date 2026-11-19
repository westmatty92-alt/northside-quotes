---
name: docs-install
description: bl-docs install and redeploy guides for agent teams (dev team, marketing team, future teams) on Baseleap's or a client's machine — machine, installer, sign-ins, accounts, configuration, first run, handoff, support and removal — built from ops-machine, the packaging decisions and a real install run. Generic: no client details in the kit version.
---

# Docs · Agent-team install and redeploy guides

## 1. Shape (`templates/team-install.md`)
Purpose · What the client gets · Before you start (hardware, accounts the client owns, who signs in) · Install (installer run, sign-ins by the human, kit version check, heartbeat in the Console) · Configure (the team's settings for this client, no secrets in files) · First run (a small task end to end) · Handoff (what the client's people do, what Baseleap does) · Support (updates, rotation, the heartbeat going quiet) · Removal (sign-outs, token revocation, wiping the kit).

## 2. Evidence
A guide is verified only when someone (or an agent) with no other context followed it on a clean machine or container and got the same result; record that run in `docs/sops/evidence.md`. Commands come from `ops-machine` templates at the kit version you name.

## 3. Rules
- One guide per team, generic; the client-specific bits (names, accounts, prices) go in a per-client checklist outside the kit.
- Production keys never live on an installed machine; say so in the guide.
- Prices and packages come from the packaging decisions, never invented.
