#!/usr/bin/env node
// PreToolUse hook (Bash): refuses any command that would change production or reveal secrets, by what the
// command does (scripts/lib/command-guard.mjs), for every session in the kit, main or subagent.
// Backs up the prefix rules in settings.json, which a reordered flag or an extra word gets around.
import { refuse } from '../../scripts/lib/command-guard.mjs';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* fall through: no command to judge */ }
  if (input.tool_name !== 'Bash') process.exit(0);
  const reason = refuse(input.tool_input?.command ?? '');
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[prod-guard] ${reason}. Don't work around this; ask Matthew.` },
    }));
  }
  process.exit(0);
});
