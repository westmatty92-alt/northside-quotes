#!/usr/bin/env node
// PreToolUse hook — keeps bl-orchestrator out of product code.
//
// Applies only to the main session running as bl-orchestrator (agent_type set, no
// agent_id). Specialists (subagents) are unaffected — their scope is set by the
// step brief and checked by review. Allowed orchestrator writes:
//   PLAN.md, .baseleap/**, docs/decisions/**

import path from 'node:path';

const ALLOWED = [/^PLAN\.md$/, /^\.baseleap\//, /^docs\/decisions\//];

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    if (input.agent_type !== 'bl-orchestrator' || input.agent_id) process.exit(0);
    if (!['Write', 'Edit', 'MultiEdit'].includes(input.tool_name)) process.exit(0);
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const file = input.tool_input?.file_path ?? '';
    const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (!rel.startsWith('..') && ALLOWED.some((re) => re.test(rel))) process.exit(0);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[orchestrator-scope] bl-orchestrator writes only PLAN.md, .baseleap/** and docs/decisions/** — "${rel}" belongs to a specialist. Route it as a ledger step.`,
      },
    }));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`[orchestrator-scope] blocked: ${e.message}\n`);
    process.exit(2);
  }
});
