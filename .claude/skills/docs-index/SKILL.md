---
name: docs-index
description: bl-docs agent index — a readable page listing every agent in the kit (name, job, when it runs, ready or skeleton, skills, what it may write, what it may never do), generated from .claude/agents and .claude/permissions.json, never written by hand. Regenerated on every kit release and published to the hub's Agents page.
---

# Docs · Agent index

## 1. Generate, don't write
Run `node scripts/agent-index.mjs > docs/sops/agents/index.md`. It reads each agent's frontmatter (name, description, status, skills) and its write globs from `.claude/permissions.json`. The agent files are the source of truth; if the index reads wrong, the agent file is what changes.

## 2. When
Every kit release (a sync that changes `.claude/agents` or `.claude/permissions.json`), and when Matthew asks. Publish to the hub's "Agents" page with `docs-publish` rules.

## 3. Check
The index lists exactly the agent files present, with the same status; `tests/agent-index.test.mjs` fails if they diverge.
