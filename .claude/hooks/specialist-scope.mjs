#!/usr/bin/env node
// PreToolUse hook (Write|Edit|MultiEdit|NotebookEdit): keeps each dev-team specialist inside the paths
// .claude/permissions.json gives it. Applies to bl-* subagents (agent_id present). Rules, in order:
//   1. Unknown bl-* agent, unreadable matrix, path outside any git checkout → deny (fail closed).
//   2. Lane agents (frontend/backend) write only inside their own worktree; nobody writes in another agent's lane.
//   3. Allowed if the path matches the agent's "write" globs (+ global everyAgentMayWrite)…
//      …except the architect after contract_lock, who needs an active (building/testing) architect step.
//   4. Otherwise allowed only if it's a file an active ledger step of this agent owns (e.g. the A2 scaffold).
// Shell writes aren't seen here; the ledger's ownership check on verify catches those.

import path from 'node:path';
import { loadPermissions, writeGlobs, matchesAny, ownerOf, locateInCheckout, laneOf, LANES } from '../../scripts/lib/permissions.mjs';

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[specialist-scope] ${reason}` },
  }));
  process.exit(0);
};

async function ledgerScope(agent) {
  const { openDb } = await import('../../scripts/lib/db.mjs');
  const { activeWriteScope, currentPlanId, agentKeyFor } = await import('../../scripts/lib/ledger-core.mjs');
  return activeWriteScope(openDb(), currentPlanId(), agentKeyFor(agent));
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw || '{}');
    if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) process.exit(0);
    const agent = input.agent_type ?? '';
    if (!input.agent_id || !agent.startsWith('bl-')) process.exit(0); // main sessions + non-team agents: other hooks/rules apply

    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const perms = loadPermissions(root);
    const globs = writeGlobs(perms, agent);
    if (!globs) deny(`${agent} is not in .claude/permissions.json — no write access until it's added there.`);

    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
    if (!target) deny('no file path in the tool call');
    const abs = path.resolve(input.cwd || root, target);
    const loc = locateInCheckout(abs);
    if (!loc) deny(`"${target}" is outside every git checkout of this project.`);
    const { rel, top } = loc;
    if (rel.startsWith('..')) deny(`"${target}" escapes its checkout.`);

    const lane = laneOf(top);
    if (LANES[agent] && lane !== LANES[agent]) deny(`${agent} works only in its ${LANES[agent]} worktree; "${target}" is in ${lane ?? 'the main tree'}.`);
    if (!LANES[agent] && lane) deny(`${agent} must not write inside the ${lane} lane — that's ${Object.keys(LANES).find((k) => LANES[k] === lane) ?? 'another agent'}'s worktree.`);

    if (matchesAny(rel, globs)) {
      if (agent !== 'bl-architect') process.exit(0);
      const scope = await ledgerScope(agent);
      if (!scope.contractLocked || scope.active) process.exit(0);
      deny(`contract_lock is approved, so the architect's files are read-only unless an architect step is reopened (contract question) or added through plan --amend. "${rel}" was not changed.`);
    }

    const scope = await ledgerScope(agent);
    if (scope.files.includes(rel)) process.exit(0);
    const owner = ownerOf(perms, rel);
    deny(`${agent} may not write "${rel}"${owner ? ` — it belongs to ${owner}. Raise a CONTRACT QUESTION in your report instead.` : '. It is outside your paths in PERMISSIONS.md and not owned by your active ledger step.'}`);
  } catch (e) {
    process.stderr.write(`[specialist-scope] blocked: could not check write permissions (${e.message}). Do not work around this hook.\n`);
    process.exit(2);
  }
});
