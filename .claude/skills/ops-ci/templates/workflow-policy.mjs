#!/usr/bin/env node
// scripts/workflow-policy.mjs (owned by bl-devops). CI policy check for .github/workflows/*.yml.
//
// Fails (exit 1) on:
//   1. `pull_request_target` or `workflow_run` triggers, unless the file starts with a comment
//      `# policy-exception: <reason>` (the exception waives this rule only).
//   2. `permissions: write-all` anywhere; workflow-level permissions other than `contents: read` (or `{}`).
//   3. Job-level write scopes outside the allow-list below (everything else is read-only).
//   4. `secrets: inherit`.
//   5. Untrusted `${{ github.event.* }}` (and `github.head_ref`) used directly inside `run:` / `script:`
//      (script injection). Pass the value through `env:` instead. Exceptions: see SAFE_EVENT_FIELDS.
//
// No dependencies: workflows are simple, so a small YAML reader is included. Anything it cannot read
// is reported as a violation (fail closed).
//
// Usage: node scripts/workflow-policy.mjs [workflows-dir]   (default: .github/workflows)

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- policy (edit here; reviewed like code) ---------------------------------------------------------
const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run'];

// Job-level write scopes allowed per workflow file (basename). Anything not listed is read-only.
export const WRITE_ALLOW_LIST = {
  'release.yml': ['deployments', 'id-token'],
  'uptime.yml': ['issues'],
};

// Event fields that are not attacker-controlled free text (commit SHA, environment name, status state).
const SAFE_EVENT_FIELDS = new Set([
  'github.event.deployment.sha',
  'github.event.deployment.environment',
  'github.event.deployment_status.state',
]);

// ---- minimal YAML reader ----------------------------------------------------------------------------
const KEY_RE = /^("[^"]*"|'[^']*'|[^\s:#'"[{|>&*!%@`-][^:]*?)\s*:(?:\s+(.*))?$/;

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i === 0 ? ' ' : s[i - 1];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if ((c === '"' || c === "'") && /[\s[,:{]/.test(prev)) q = c;
    else if (c === '#' && /\s/.test(prev)) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (const c of s) {
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

function scalar(v) {
  const s = v.trim();
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(scalar);
  if (s.startsWith('{') && s.endsWith('}') && !s.startsWith('{{')) {
    const o = {};
    for (const item of splitTop(s.slice(1, -1))) {
      const m = KEY_RE.exec(item);
      if (!m) throw new Error(`cannot read flow mapping item: ${item}`);
      o[unquote(m[1])] = scalar(m[2] ?? '');
    }
    return o;
  }
  return unquote(s);
}

export function parseYaml(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  const blank = (l) => l.trim() === '' || l.trim().startsWith('#');
  const skip = () => {
    while (i < lines.length && blank(lines[i])) i++;
  };

  function block(minIndent) {
    skip();
    if (i >= lines.length || indentOf(lines[i]) < minIndent) return null;
    const ind = indentOf(lines[i]);
    const text = stripComment(lines[i].trim());
    return text === '-' || text.startsWith('- ') ? seq(ind) : map(ind);
  }

  function valueAfter(raw, ind) {
    const v = raw === undefined ? '' : stripComment(raw);
    if (/^[|>][+-]?\d*$/.test(v)) {
      const body = [];
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > ind)) body.push(lines[i++]);
      return body.join('\n');
    }
    if (v === '') {
      skip();
      if (i < lines.length) {
        const t = lines[i].trim();
        const li = indentOf(lines[i]);
        if (li > ind) return block(li);
        if (li === ind && (t === '-' || t.startsWith('- '))) return seq(ind); // seq at the key's own indent
      }
      return null;
    }
    return scalar(v);
  }

  function map(ind) {
    const o = {};
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind) break;
      const text = stripComment(lines[i].trim());
      if (text === '-' || text.startsWith('- ')) break;
      const m = KEY_RE.exec(text);
      if (!m) throw new Error(`line ${i + 1}: cannot read "${text}"`);
      i++;
      o[unquote(m[1])] = valueAfter(m[2], ind);
    }
    return o;
  }

  function seq(ind) {
    const a = [];
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind) break;
      const text = stripComment(lines[i].trim());
      if (!(text === '-' || text.startsWith('- '))) break;
      const rest = text === '-' ? '' : text.slice(2).trimStart();
      if (rest === '') {
        i++;
        skip();
        a.push(i < lines.length && indentOf(lines[i]) > ind ? block(indentOf(lines[i])) : null);
      } else if (KEY_RE.test(rest)) {
        // "- key: value": re-read this line as a mapping whose keys start after the dash.
        const offset = lines[i].indexOf(rest, lines[i].indexOf('-') + 1);
        lines[i] = ' '.repeat(offset) + rest;
        a.push(map(offset));
      } else {
        i++;
        a.push(scalar(rest));
      }
    }
    return a;
  }

  const doc = block(0);
  skip();
  if (i < lines.length) throw new Error(`line ${i + 1}: unexpected content "${lines[i].trim()}"`);
  return doc;
}

// ---- checks -----------------------------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function walk(node, pathParts, visit) {
  visit(node, pathParts);
  if (Array.isArray(node)) node.forEach((v, idx) => walk(v, [...pathParts, String(idx)], visit));
  else if (isObj(node)) for (const [k, v] of Object.entries(node)) walk(v, [...pathParts, k], visit);
}

const jobOf = (p) => (p[0] === 'jobs' && p[1] ? p[1] : '(workflow)');

export function checkWorkflow(file, source) {
  const base = path.basename(file);
  const out = [];
  const bad = (job, message) => out.push({ file, job, message });

  let doc;
  try {
    doc = parseYaml(source);
  } catch (e) {
    bad('(workflow)', `cannot parse workflow, failing closed: ${e.message}`);
    return out;
  }
  if (!isObj(doc)) {
    bad('(workflow)', 'workflow is not a YAML mapping');
    return out;
  }

  // 1. triggers
  let exception = null;
  for (const l of source.split(/\r?\n/)) {
    const t = l.trim();
    if (t === '') continue;
    if (!t.startsWith('#')) break;
    const m = /^#\s*policy-exception:\s*(\S.*)$/.exec(t);
    if (m) exception = m[1];
  }
  const on = doc.on ?? doc.true;
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : isObj(on) ? Object.keys(on) : [];
  for (const t of triggers) {
    if (FORBIDDEN_TRIGGERS.includes(t) && !exception)
      bad('(workflow)', `trigger "${t}" is forbidden (runs with secrets and a write token in the context of untrusted PR code); add a "# policy-exception: <reason>" top comment only with a recorded reason`);
  }

  // 2. workflow-level permissions
  const wfPerms = doc.permissions;
  if (wfPerms === undefined || wfPerms === null) {
    bad('(workflow)', 'no workflow-level "permissions": must be "contents: read" (or {})');
  } else if (typeof wfPerms === 'string') {
    if (wfPerms !== 'write-all') bad('(workflow)', `workflow-level permissions "${wfPerms}": must be "contents: read" (or {})`);
  } else if (isObj(wfPerms)) {
    for (const [scope, level] of Object.entries(wfPerms)) {
      if (scope === 'contents' && level === 'read') continue;
      bad('(workflow)', `workflow-level permission "${scope}: ${level}" not allowed (only "contents: read"; grant extra scopes per job)`);
    }
  } else bad('(workflow)', 'workflow-level permissions are unreadable');

  // write-all anywhere
  walk(doc, [], (node, p) => {
    if (p[p.length - 1] === 'permissions' && node === 'write-all') bad(jobOf(p), 'permissions: write-all is forbidden');
  });

  // 3. job-level write scopes
  const allowed = WRITE_ALLOW_LIST[base] ?? [];
  for (const [job, def] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
    const perms = isObj(def) ? def.permissions : undefined;
    if (perms === undefined || perms === null) continue;
    if (typeof perms === 'string') {
      if (perms !== 'write-all' && perms !== 'read-all') bad(job, `unknown permissions value "${perms}"`);
    } else if (isObj(perms)) {
      for (const [scope, level] of Object.entries(perms)) {
        if (level === 'write' && !allowed.includes(scope))
          bad(job, `write scope "${scope}: write" is not in the allow-list for ${base} (${allowed.length ? allowed.join(', ') : 'read-only'})`);
        else if (!['read', 'write', 'none'].includes(level)) bad(job, `permission "${scope}: ${level}" is not read, write or none`);
      }
    } else bad(job, 'job-level permissions are unreadable');
  }

  // 4 + 5. secrets: inherit, and untrusted expressions in run:/script:
  walk(doc, [], (node, p) => {
    const key = p[p.length - 1];
    if (key === 'secrets' && node === 'inherit') bad(jobOf(p), '"secrets: inherit" is forbidden; pass the specific secrets needed');
    if ((key === 'run' || key === 'script') && typeof node === 'string') {
      for (const expr of node.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const refs = expr[1].match(/github\.(?:event\.[A-Za-z0-9_.[\]*'-]+|head_ref)/g) ?? [];
        for (const ref of refs) {
          if (!SAFE_EVENT_FIELDS.has(ref))
            bad(jobOf(p), `"\${{ ${ref} }}" used directly in ${key}: (script injection); pass it through env: and quote the variable`);
        }
      }
    }
  });

  return out;
}

export function checkDir(dir) {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  return {
    files,
    violations: files.flatMap((f) => checkWorkflow(path.join(dir, f), readFileSync(path.join(dir, f), 'utf8'))),
  };
}

// ---- CLI --------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.github/workflows';
  const { files, violations } = checkDir(dir);
  if (files.length === 0) {
    console.error(`workflow-policy: no workflow files found in ${dir}`);
    process.exit(1);
  }
  for (const v of violations) console.error(`::error file=${v.file}::${v.file} | job: ${v.job} | ${v.message}`);
  if (violations.length) {
    console.error(`workflow-policy: ${violations.length} violation(s) in ${files.length} file(s)`);
    process.exit(1);
  }
  console.log(`workflow-policy: ${files.length} workflow(s) pass (${files.join(', ')})`);
}
