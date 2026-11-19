---
name: ops-machine
description: Machine setup for bl-devops — the installer that turns a fresh always-on machine (Baseleap's mini PC, or a client's office machine for an installed department) into a working agent host: packages, Claude Code, the kit, scheduled jobs, remote health checks and updates from the Baseleap kit repo, with no client details or secret values baked in. Use when a step sets up, updates or audits an agent machine.
---

# DevOps · Agent machines

One installer, many machines. The same script sets up Baseleap's own mini PC and every client install; what differs is a small per-machine config file, never the script.

## 1. Rules
- **Idempotent:** running it twice changes nothing the second time. Every step checks before it acts.
- **No secrets in the installer or the repo.** Keys are entered by the owner during setup (or by Matthew for Baseleap's machine) into the OS keyring or the tool's own login, never into a file the kit ships.
- **No client details in the kit.** Per-machine values (operator name, client id, which teams are enabled, timezone) live in `machine.json`, which the installer asks for and never commits.
- **Each client uses their own accounts** (their Claude account or API key, their GitHub, their providers). Never Baseleap's.
- **Pinned and verified:** tool versions pinned, downloads checksum-verified (same approach as `install-scanners.sh`). **A pin comes from a checked source** (the version running on a proven machine, or the registry's own listing read during the step), never from memory. Say where each pin came from in the report.
- **Updates come from the kit repo:** a scheduled pull of the tagged kit release, applied only if its tests pass; the machine reports its kit version.
- **Health is reported out, not polled in:** a small heartbeat (machine id, kit version, last successful job, disk, failing checks) goes to Baseleap's "Needs you" feed. No inbound ports.
- **Sleep and power:** the machine never sleeps; jobs survive a reboot (systemd user services or equivalent, not a terminal loop).

## 2. Output
- `infra/machine/install.sh` (the kit itself ships a copy at `infra/machine/`, kept identical by `tests/machine-installer.test.mjs`, so the dev team install guide works from a kit checkout or bundle; from `templates/install.sh`, v1 proven Nov 15 in a container: run 1 = 15 changes, run 2 = 0 changes, kit tests 134/134 inside; drill script in `templates/drill/`), `infra/machine/machine.example.json`, and a runbook section: setup, update, recovery, and decommissioning (revoke keys, wipe, return hardware).
- Before a client install ships: a dry run on a clean machine or VM, with the checklist in the runbook ticked.
