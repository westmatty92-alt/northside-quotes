// Shared reader for .claude/permissions.json, the single source of truth for who may write where.
// Used by the specialist-scope hook, the ledger's ownership check and sync-agent-permissions.

import fs from 'node:fs';
import path from 'node:path';

export const LANES = { 'bl-frontend': 'wt-frontend', 'bl-backend': 'wt-backend' };

export function loadPermissions(root) {
  const file = path.join(root, '.claude', 'permissions.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc.agents || !doc.global) throw new Error('permissions.json is missing "agents" or "global"');
  return doc;
}

/** Glob → RegExp. Supports ** (any depth), * (one segment), and <PLACEHOLDER> (one segment). Everything else is literal. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'; i++;
      if (glob[i + 1] === '/') i++;          // "**/" also matches zero directories
    } else if (c === '*') re += '[^/]*';
    else if (c === '<') { const end = glob.indexOf('>', i); re += '[^/]*'; i = end === -1 ? i : end; }
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Only entries that look like paths are globs; prose entries ("scaffold files in the A2 step") are ignored. */
export const isPathPattern = (s) => typeof s === 'string' && !/\s/.test(s) && /[./*]/.test(s);

export function writeGlobs(perms, agent) {
  const a = perms.agents[agent];
  if (!a) return null;
  return [...(a.write ?? []), ...(perms.global.everyAgentMayWrite ?? [])].filter(isPathPattern);
}

export function matchesAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

/** Who owns a path according to the matrix (for helpful deny messages). */
export function ownerOf(perms, rel) {
  for (const [name, a] of Object.entries(perms.agents)) {
    if ((a.write ?? []).filter(isPathPattern).some((g) => globToRegExp(g).test(rel))) return name;
  }
  return null;
}

/** Finds the git checkout (main tree or a lane worktree) that contains a path, and the path relative to it. */
export function locateInCheckout(absPath) {
  let dir = path.dirname(absPath);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return { top: dir, rel: path.relative(dir, absPath).split(path.sep).join('/') };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Lane of a checkout from its folder name ("<repo>-wt-frontend" → "wt-frontend"), or null for the main tree. */
export const laneOf = (top) => path.basename(top).match(/-(wt-[a-z0-9-]+)$/)?.[1] ?? null;
