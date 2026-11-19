#!/usr/bin/env node
// UserPromptSubmit: warn at the START of a session if it runs in a mode every specialist would inherit
// (auto / acceptEdits / bypassPermissions). gate-guard refuses team dispatch in those modes anyway;
// this makes the orchestrator say so before intake instead of at the first dispatch. Never blocks a prompt.
const UNSAFE_MODES = ['bypassPermissions', 'acceptEdits', 'auto'];
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (!UNSAFE_MODES.includes(input.permission_mode)) process.exit(0);
  const msg = `This session is in "${input.permission_mode}" mode. The Dev Team can't be dispatched in it (gate-guard refuses). `
    + 'Restart with: claude --agent bl-orchestrator --permission-mode default';
  process.stdout.write(JSON.stringify({
    systemMessage: `⚠ ${msg}`,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `${msg} Tell Matthew this before asking any intake question, and don't mark steps building until the session is restarted.`,
    },
  }));
});
