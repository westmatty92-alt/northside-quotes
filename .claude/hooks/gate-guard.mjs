#!/usr/bin/env node
// PreToolUse hook — mechanical enforcement of dev-team dispatch rules.
//
// Fires on Agent/Task tool calls. For any bl-* specialist it requires:
//   * the dispatch comes from the orchestrator (no specialist spawning specialists)
//   * the prompt names a ledger step:  "STEP: <id>" on its own line
//   * that step's agent matches, its dependencies are verified done, its phase gate
//     is approved, no escalation is open (see ledger-core.checkDispatch)
// Fails CLOSED: if the ledger can't be reached, the dispatch is blocked.
// Non-dev-team agents (Explore, Plan, general-purpose…) pass through untouched.

import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../scripts/lib/db.mjs';
import { checkDispatch, currentPlanId } from '../../scripts/lib/ledger-core.mjs';

const READ_ONLY_HELPERS = ['Explore', 'Plan'];
const UNSAFE_MODES = ['bypassPermissions', 'acceptEdits', 'auto'];

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[gate-guard] ${reason}`,
    },
  }));
  process.exit(0);
};

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw || '{}');
    if (!['Agent', 'Task'].includes(input.tool_name)) process.exit(0);
    const target = input.tool_input?.subagent_type ?? '';
    if (!target.startsWith('bl-')) {
      // The orchestrator may use read-only helpers, but never a general agent that can write code
      // around the specialists, their lanes and the ledger.
      const fromOrchestrator = input.agent_type === 'bl-orchestrator' && !input.agent_id;
      if (fromOrchestrator && !READ_ONLY_HELPERS.includes(target)) {
        deny(`bl-orchestrator may only use read-only helpers (${READ_ONLY_HELPERS.join(', ')}) outside the team — "${target || 'general-purpose'}" can write files. Plan the work as a ledger step for the right specialist.`);
      }
      process.exit(0);
    }

    // Subagents inherit bypass/auto/accept-edits from the main session and ignore their own mode,
    // which would switch off every specialist's permission prompts at once.
    if (UNSAFE_MODES.includes(input.permission_mode)) {
      deny(`this session runs in "${input.permission_mode}" mode, which every specialist would inherit. Restart the orchestrator in default mode (claude --agent bl-orchestrator --permission-mode default) before dispatching the team.`);
    }

    if (target === 'bl-orchestrator') deny('bl-orchestrator runs as the main session (claude --agent bl-orchestrator --permission-mode default), never as a subagent');

    // agent_id is present when the call comes from inside a subagent.
    if (input.agent_id && input.agent_type !== 'bl-orchestrator') {
      deny(`only the orchestrator dispatches the dev team — ${input.agent_type ?? 'a subagent'} tried to spawn ${target}. Report back to the orchestrator instead.`);
    }

    // The specialist must exist and be built — skeleton files are blueprints, not agents.
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const agentFile = path.join(root, '.claude', 'agents', `${target}.md`);
    if (!fs.existsSync(agentFile)) deny(`${target} has no agent file (.claude/agents/${target}.md) — that role isn't built yet. Tell Matthew; don't substitute another agent.`);
    const front = fs.readFileSync(agentFile, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    if (/^baseleap-status:\s*skeleton\s*$/m.test(front)) deny(`${target} is still a skeleton (baseleap-status: skeleton) — build it before dispatching to it.`);

    const m = String(input.tool_input?.prompt ?? '').match(/^\s*STEP:\s*([A-Za-z][A-Za-z0-9._-]{0,31})\s*$/m);
    const db = openDb();
    const r = await checkDispatch(db, currentPlanId(), { subagentType: target, stepLocalId: m?.[1] ?? null });
    if (!r.allow) deny(r.reason);
    process.exit(0); // allowed — normal permission flow continues
  } catch (e) {
    process.stderr.write(`[gate-guard] blocked: could not verify dispatch against the ledger (${e.message}). Fix the ledger connection; do not work around this hook.\n`);
    process.exit(2);
  }
});
