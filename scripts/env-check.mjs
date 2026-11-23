#!/usr/bin/env node
// scripts/env-check.mjs (owned by bl-devops). Environment drift check. NAMES ONLY: no value is ever read, printed or stored.
//
//   node scripts/env-check.mjs                  manifest checks (same as --manifest-only)
//   node scripts/env-check.mjs --manifest-only  infra/environments.json vs the code in src/, .env.example and the
//                                               workflows. No network, no Vercel call.
//   node scripts/env-check.mjs --self-test      proves the checker catches drift: fixtures built from the real manifest
//                                               (one missing CRON_SECRET, one missing APP_SIGNING_SECRET, a secret stored
//                                               as plain text, a CI-only name set in Vercel, ...) must each FAIL the check.
//                                               Exits 0 only if every fixture is rejected and the clean fixture passes.
//   node scripts/env-check.mjs --vercel         manifest checks, then the Vercel project's variables (needs VERCEL_TOKEN
//                                               and VERCEL_PROJECT_ID; VERCEL_TEAM_ID or VERCEL_ORG_ID optional). The API
//                                               is called without decrypt: only name, target, branch and type come back
//                                               into this script, and only those are kept.
//   --root <dir>                                check another checkout (used by tests)
//
// SEC-4 (docs/architecture.md "Build requirements from S0"): APP_SIGNING_SECRET and CRON_SECRET must be declared
// sensitive and required for BOTH Production and Preview, and (with --vercel) present in both. Exit 1 on any error.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SECRETISH = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|WEBHOOK|DB_URL|_SK_|^SK_)/;
const IGNORED_RUNTIME = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'NEXT_PHASE', 'CI', 'VERCEL', 'VERCEL_URL', 'VERCEL_REGION']);
const SEC4_NAMES = ['APP_SIGNING_SECRET', 'CRON_SECRET'];
const SCOPES = new Set(['app', 'system', 'ci', 'orchestrator']);
// Token A (Matthew, Nov 19 2026): no Supabase personal access token anywhere, and the production connection string
// makes the password and project-ref variables redundant. These names must not come back.
const FORBIDDEN_NAMES = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PRODUCTION_REF'];
const PLACEHOLDER = /^(|<.*>|your[-_].*|changeme|placeholder.*)$/i;
const SECRET_SHAPED = /(eyJ[A-Za-z0-9_-]{10,}|sb_secret_|sb_publishable_[A-Za-z0-9_-]{8,}|sk_(live|test)_|gh[pousr]_[A-Za-z0-9]{20,}|postgres(ql)?:\/\/[^:@/\s]+:[^@\s]+@|[A-Za-z0-9+/_-]{40,})/;

// ---- reading the repo (names only) -------------------------------------------------------------------

function walkSource(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'generated', '.next'].includes(e.name)) walkSource(p, visit);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.(ts|tsx|js|mjs)$/.test(e.name)) visit(p, fs.readFileSync(p, 'utf8'));
  }
}

/** Names the code reads: process.env.X, process.env['X'] and `const { X } = process.env` under src/ (test files excluded). */
export function scanSource(root) {
  const used = new Set();
  walkSource(path.join(root, 'src'), (_p, text) => {
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) used.add(m[1] ?? m[2]);
    for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*process\.env\b/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) used.add(name);
      }
    }
  });
  return used;
}

/** Which of `names` appear anywhere in src/ as a whole word (covers env.ts-style readSecret('NAME') helpers). */
export function scanMentions(root, names) {
  const found = new Set();
  walkSource(path.join(root, 'src'), (_p, text) => {
    for (const n of names) if (new RegExp(`\\b${n}\\b`).test(text)) found.add(n);
  });
  return found;
}

export function readEnvExample(root) {
  const p = path.join(root, '.env.example');
  if (!fs.existsSync(p)) return null;
  const vars = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) vars.set(m[1], m[2].trim());
  }
  return vars;
}

/** { files: Map(name -> text), refs: Set of secrets.X / vars.X names } for .github/workflows. */
export function readWorkflows(root) {
  const dir = path.join(root, '.github', 'workflows');
  const files = new Map();
  const refs = new Set();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      files.set(f, text);
      for (const m of text.matchAll(/\b(?:secrets|vars)\.([A-Za-z][A-Za-z0-9_]*)/g)) if (m[1] !== 'GITHUB_TOKEN') refs.add(m[1]);
    }
  }
  return { files, refs };
}

// ---- checks (pure; exported for tests) ----------------------------------------------------------------

/** Errors in the manifest itself and against .env.example. */
export function checkLocal(manifest, used, example) {
  const errors = [];
  const vars = manifest.variables ?? [];
  const declared = new Map(vars.map((v) => [v.name, v]));
  const ignored = (name) => IGNORED_RUNTIME.has(name) || (manifest.ignoredPrefixes ?? []).some((p) => name.startsWith(p));

  for (const name of used) if (!declared.has(name) && !ignored(name)) errors.push(`undeclared: ${name} is used in src/ but not in infra/environments.json`);

  for (const v of vars) {
    if (!SCOPES.has(v.scope)) errors.push(`scope: ${v.name} has scope "${v.scope}" (app, system, ci or orchestrator)`);
    if (v.public && !v.name.startsWith('NEXT_PUBLIC_')) errors.push(`public-name: ${v.name} is marked public but is not NEXT_PUBLIC_*`);
    if (v.name.startsWith('NEXT_PUBLIC_') && SECRETISH.test(v.name.replace('NEXT_PUBLIC_', ''))) errors.push(`public-secret: ${v.name} looks secret but would ship to the browser`);
    if (v.sensitive && v.name.startsWith('NEXT_PUBLIC_')) errors.push(`public-secret: ${v.name} is sensitive but NEXT_PUBLIC_*`);
    if (!v.sensitive && !v.public && SECRETISH.test(v.name)) errors.push(`unmarked-secret: ${v.name} looks secret; mark it "sensitive": true`);
    for (const t of ['production', 'preview']) {
      if (!['required', 'optional', 'absent'].includes(v[t])) errors.push(`rule: ${v.name} has no ${t} rule (required, optional or absent)`);
    }
    if (v.scope && v.scope !== 'app' && (v.production !== 'absent' || v.preview !== 'absent')) {
      errors.push(`scope-rule: ${v.name} is ${v.scope}-only and must be "absent" from Vercel (production and preview)`);
    }
    if (FORBIDDEN_NAMES.includes(v.name)) errors.push(`forbidden-name: ${v.name} must not be declared (token A)`);
  }

  for (const name of SEC4_NAMES) {
    const v = declared.get(name);
    if (!v) errors.push(`required-secret: ${name} is not declared in the manifest (SEC-4)`);
    else if (!v.sensitive || v.production !== 'required' || v.preview !== 'required' || v.scope !== 'app') {
      errors.push(`required-secret: ${name} must be an app variable, sensitive, and required for both production and preview (SEC-4)`);
    }
  }

  // GitHub placement: each listed name is declared, and sits only in the environments its variable says.
  const gh = manifest.github ?? {};
  const listed = (e) => [...(gh[e]?.secrets ?? []), ...(gh[e]?.variables ?? []), ...(gh[e]?.optionalSecrets ?? [])];
  for (const env of Object.keys(gh)) {
    for (const name of listed(env)) {
      const v = declared.get(name);
      if (!v) errors.push(`github-undeclared: ${name} is listed under github.${env} but not declared in variables`);
      else if (!(v.githubEnvs ?? []).includes(env)) errors.push(`github-placement: ${name} is listed under github.${env} but its githubEnvs is [${(v.githubEnvs ?? []).join(', ')}]`);
    }
  }
  for (const v of vars) {
    for (const env of v.githubEnvs ?? []) if (!listed(env).includes(v.name)) errors.push(`github-missing: ${v.name} says it lives in github.${env} but that list does not name it`);
  }
  if (gh.production && gh.production.allowAdministratorsToBypass !== false) errors.push('github-production: allowAdministratorsToBypass must be false');
  if (gh.production && !(gh.production.requiredReviewers ?? []).length) errors.push('github-production: requiredReviewers is empty');

  if (!example) errors.push('example-missing: .env.example does not exist');
  else {
    // System variables are deliberately not in .env.example: an empty copy in .env.local would shadow Vercel's value.
    for (const v of vars) if (v.scope !== 'system' && !example.has(v.name)) errors.push(`example-missing: ${v.name} is not in .env.example`);
    for (const v of vars) if (v.scope === 'system' && example.has(v.name)) errors.push(`example-system: ${v.name} is a Vercel system variable and must not be in .env.example`);
    const declaredOrIgnored = (name) => declared.has(name) || ignored(name);
    for (const [name, value] of example) {
      if (!declaredOrIgnored(name)) errors.push(`example-extra: ${name} is in .env.example but not in the manifest`);
      if (FORBIDDEN_NAMES.includes(name)) errors.push(`forbidden-name: ${name} is in .env.example (token A)`);
      const v = declared.get(name);
      if (v && (v.sensitive || SECRETISH.test(name)) && !PLACEHOLDER.test(value)) errors.push(`example-value: .env.example has a non-placeholder value for ${name}`);
      else if (SECRET_SHAPED.test(value)) errors.push(`example-value: .env.example value for ${name} looks like a real secret`);
    }
  }
  return errors;
}

/** Warnings only: declared app variables the code does not mention yet (lanes land at different times). */
export function warnLocal(manifest, mentioned) {
  return (manifest.variables ?? [])
    .filter((v) => v.scope === 'app' && (v.production === 'required' || v.preview === 'required') && !mentioned.has(v.name))
    .map((v) => `declared-unused: ${v.name} is required but no file in src/ names it yet`);
}

/** Workflows may only reference names the manifest declares and places, and never the forbidden ones. */
export function checkWorkflows(manifest, workflows) {
  const errors = [];
  const gh = manifest.github ?? {};
  const placed = new Set(Object.values(gh).flatMap((e) => [...(e.secrets ?? []), ...(e.variables ?? []), ...(e.optionalSecrets ?? [])]));
  for (const name of workflows.refs) {
    if (!placed.has(name)) errors.push(`workflow-undeclared: a workflow reads secrets/vars ${name}, which is not placed under github.* in infra/environments.json`);
  }
  for (const [file, text] of workflows.files) {
    for (const n of FORBIDDEN_NAMES) if (text.includes(n)) errors.push(`forbidden-name: ${file} mentions ${n} (token A)`);
  }
  return errors;
}

/** vercel.json says what the manifest's vercelConfig says: region, cron entries (exactly), and no Git deploys of main. */
export function checkVercelConfig(manifest, vercelJson) {
  const errors = [];
  const want = manifest.vercelConfig;
  if (!want) return ['vercel-config: infra/environments.json has no vercelConfig section'];
  if (!vercelJson) return ['vercel-config: vercel.json is missing or unreadable'];
  if (JSON.stringify(vercelJson.regions ?? []) !== JSON.stringify(want.regions)) errors.push(`vercel-config: regions must be ${JSON.stringify(want.regions)}`);
  if (vercelJson.git?.deploymentEnabled?.main !== want.gitDeploymentEnabledMain) errors.push('vercel-config: git.deploymentEnabled.main must be false (production deploys only through release.yml)');
  const key = (c) => `${c.path} ${c.schedule}`;
  const have = (vercelJson.crons ?? []).map(key).sort();
  const need = want.crons.map(key).sort();
  if (JSON.stringify(have) !== JSON.stringify(need)) errors.push(`vercel-config: crons must be exactly [${need.join('; ')}], found [${have.join('; ')}]`);
  if (vercelJson.headers) errors.push('vercel-config: vercel.json must not define headers (next.config.ts owns them)');
  return errors;
}

/** Best-effort syntax and structure check of the workflow files, when a YAML parser is installed (a transitive dependency). */
export function checkWorkflowYaml(workflows, parse) {
  const errors = [];
  for (const [file, text] of workflows.files) {
    try {
      const doc = parse(text);
      if (!doc || typeof doc !== 'object' || !doc.jobs) errors.push(`workflow-yaml: ${file} has no jobs`);
      else if (!doc.permissions && doc.permissions !== '') errors.push(`workflow-permissions: ${file} has no top-level permissions block`);
    } catch (e) {
      errors.push(`workflow-yaml: ${file} does not parse (${String(e.message).split('\n')[0]})`);
    }
  }
  return errors;
}

// Vercel API rows: { key, target: ['production'|'preview'|'development'], gitBranch?, type: 'encrypted'|'sensitive'|'plain'|'system'|... }
export function checkVercel(manifest, rows) {
  const errors = [];
  const real = rows.filter((r) => r.type !== 'system');
  const has = (name, target, branch) => real.some((r) => r.key === name && r.target.includes(target) && (branch ? r.gitBranch === branch || !r.gitBranch : !r.gitBranch));
  const anywhere = (name, target) => real.some((r) => r.key === name && r.target.includes(target));
  for (const v of manifest.variables) {
    for (const target of ['production', 'preview']) {
      const rule = v[target];
      if (rule === 'required' && !has(v.name, target)) errors.push(`missing: ${v.name} not set for ${target}${target === 'preview' ? ' (All Preview Branches)' : ''}`);
      if (rule === 'absent' && anywhere(v.name, target)) errors.push(`must-be-absent: ${v.name} is set for ${target} (${v.scope === 'app' ? 'must not be set' : `${v.scope}-only name`})`);
    }
    for (const [branch, rule] of Object.entries(v.branches ?? {})) {
      if (rule === 'required' && !has(v.name, 'preview', branch)) errors.push(`missing: ${v.name} not set for preview branch ${branch}`);
      if (rule === 'absent' && real.some((r) => r.key === v.name && r.target.includes('preview') && r.gitBranch === branch)) errors.push(`must-be-absent: ${v.name} is set for preview branch ${branch}`);
    }
    if (v.sensitive) for (const r of real.filter((x) => x.key === v.name && x.type === 'plain')) errors.push(`plain-secret: ${v.name} is stored as plain text in Vercel (${r.target.join(',')}); re-add it as Sensitive`);
  }
  const declared = new Set(manifest.variables.map((v) => v.name));
  for (const r of real) if (!declared.has(r.key)) errors.push(`undeclared-in-vercel: ${r.key} is set in Vercel but not in the manifest`);
  return errors;
}

// ---- Vercel (read-only, no decrypt) -------------------------------------------------------------------

async function fetchVercelRows() {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, VERCEL_ORG_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) throw new Error('--vercel needs VERCEL_TOKEN and VERCEL_PROJECT_ID in the environment');
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`);
  const team = VERCEL_TEAM_ID || VERCEL_ORG_ID;
  if (team) url.searchParams.set('teamId', team); // decrypt is never requested: values stay encrypted
  const res = await fetch(url, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Vercel API answered ${res.status}`);
  const body = await res.json();
  // Keep names, targets, branch and type only. Values (even encrypted ones) are dropped here.
  return (body.envs ?? []).map(({ key, target, gitBranch, type }) => ({ key, target: [].concat(target ?? []), gitBranch: gitBranch ?? null, type }));
}

// ---- self-test ---------------------------------------------------------------------------------------

function rowsFromManifest(manifest) {
  const rows = [];
  for (const v of manifest.variables) {
    const targets = ['production', 'preview'].filter((t) => v[t] === 'required');
    if (targets.length) rows.push({ key: v.name, target: targets, gitBranch: null, type: v.sensitive ? 'sensitive' : 'plain' });
  }
  return rows;
}

export function selfTest(manifest) {
  const results = [];
  const expect = (label, ok) => results.push({ label, ok });
  const good = rowsFromManifest(manifest);
  const without = (name, target) => good.flatMap((r) => {
    if (r.key !== name) return [r];
    const left = r.target.filter((t) => t !== target);
    return left.length ? [{ ...r, target: left }] : [];
  });
  const errs = (rows) => checkVercel(manifest, rows).join('\n');

  expect('clean fixture (every required name present) passes', checkVercel(manifest, good).length === 0);
  expect('fixture missing CRON_SECRET in production fails', /missing: CRON_SECRET not set for production/.test(errs(without('CRON_SECRET', 'production'))));
  expect('fixture missing CRON_SECRET in preview fails', /missing: CRON_SECRET not set for preview/.test(errs(without('CRON_SECRET', 'preview'))));
  expect('fixture missing APP_SIGNING_SECRET in production fails', /missing: APP_SIGNING_SECRET not set for production/.test(errs(without('APP_SIGNING_SECRET', 'production'))));
  expect('fixture missing APP_SIGNING_SECRET in preview fails', /missing: APP_SIGNING_SECRET not set for preview/.test(errs(without('APP_SIGNING_SECRET', 'preview'))));
  expect('CRON_SECRET limited to the staging branch (not All Preview Branches) fails',
    /missing: CRON_SECRET not set for preview/.test(errs(good.map((r) => (r.key === 'CRON_SECRET' ? { ...r, target: ['production'] } : r)).concat([{ key: 'CRON_SECRET', target: ['preview'], gitBranch: 'staging', type: 'sensitive' }]))));
  expect('APP_SIGNING_SECRET stored as plain text fails', /plain-secret: APP_SIGNING_SECRET/.test(errs(good.map((r) => (r.key === 'APP_SIGNING_SECRET' ? { ...r, type: 'plain' } : r)))));
  expect('a production database URL set in Vercel fails', /must-be-absent: SUPABASE_PRODUCTION_DB_URL/.test(errs(good.concat([{ key: 'SUPABASE_PRODUCTION_DB_URL', target: ['production'], gitBranch: null, type: 'sensitive' }]))));
  expect('an undeclared variable in Vercel fails', /undeclared-in-vercel: SOMETHING_ELSE/.test(errs(good.concat([{ key: 'SOMETHING_ELSE', target: ['production'], gitBranch: null, type: 'plain' }]))));
  expect('a Vercel system variable row is ignored', checkVercel(manifest, good.concat([{ key: 'VERCEL_GIT_COMMIT_SHA', target: ['production', 'preview'], gitBranch: null, type: 'system' }])).length === 0);

  const dropped = { ...manifest, variables: manifest.variables.filter((v) => v.name !== 'CRON_SECRET') };
  const nameOnly = (override = {}) => new Map(manifest.variables.filter((v) => v.scope !== 'system').map((v) => [v.name, override[v.name] ?? '']));
  const exampleLines = nameOnly();
  expect('manifest without CRON_SECRET fails', /required-secret: CRON_SECRET/.test(checkLocal(dropped, new Set(), exampleLines).join('\n')));
  const weakened = { ...manifest, variables: manifest.variables.map((v) => (v.name === 'CRON_SECRET' ? { ...v, preview: 'optional' } : v)) };
  expect('manifest that makes CRON_SECRET optional in preview fails', /required-secret: CRON_SECRET/.test(checkLocal(weakened, new Set(), exampleLines).join('\n')));
  expect('manifest checks pass on the real manifest with a name-only example', checkLocal(manifest, new Set(), exampleLines).length === 0);
  expect('a real-looking value in .env.example fails', /example-value: .*CRON_SECRET/.test(checkLocal(manifest, new Set(), nameOnly({ CRON_SECRET: 'a'.repeat(48) })).join('\n')));
  expect('a name missing from .env.example fails', /example-missing: CRON_SECRET/.test(checkLocal(manifest, new Set(), new Map([...exampleLines].filter(([k]) => k !== 'CRON_SECRET'))).join('\n')));
  expect('a variable used in src/ but not declared fails', /undeclared: NOT_DECLARED/.test(checkLocal(manifest, new Set(['NOT_DECLARED']), exampleLines).join('\n')));
  expect('a Supabase access token name in a workflow fails', /forbidden-name: x\.yml/.test(checkWorkflows(manifest, { files: new Map([['x.yml', `env:\n  T: \${{ secrets.${FORBIDDEN_NAMES[0]} }}`]]), refs: new Set() }).join('\n')));
  expect('a workflow reading an undeclared secret fails', /workflow-undeclared: .*NOT_PLACED/.test(checkWorkflows(manifest, { files: new Map(), refs: new Set(['NOT_PLACED']) }).join('\n')));
  const config = JSON.parse(JSON.stringify({ regions: manifest.vercelConfig.regions, git: { deploymentEnabled: { main: false } }, crons: manifest.vercelConfig.crons }));
  expect('a vercel.json that matches passes', checkVercelConfig(manifest, config).length === 0);
  expect('a vercel.json with a cron missing fails', /vercel-config: crons/.test(checkVercelConfig(manifest, { ...config, crons: config.crons.slice(1) }).join('\n')));
  expect('a vercel.json that lets Git deploy main fails', /deploymentEnabled\.main/.test(checkVercelConfig(manifest, { ...config, git: {} }).join('\n')));
  expect('a vercel.json in another region fails', /vercel-config: regions/.test(checkVercelConfig(manifest, { ...config, regions: ['iad1'] }).join('\n')));
  const stubParse = (text) => { if (text.includes('BROKEN')) throw new Error('bad indentation'); return text.includes('NOPERMS') ? { jobs: {} } : { permissions: { contents: 'read' }, jobs: {} }; };
  expect('a workflow that does not parse fails', /workflow-yaml: x\.yml/.test(checkWorkflowYaml({ files: new Map([['x.yml', 'BROKEN']]) }, stubParse).join('\n')));
  expect('a workflow without a permissions block fails', /workflow-permissions: x\.yml/.test(checkWorkflowYaml({ files: new Map([['x.yml', 'NOPERMS']]) }, stubParse).join('\n')));
  return results;
}

// ---- CLI --------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--vercel', '--manifest-only', '--self-test', '--root']);
  const rootIdx = args.indexOf('--root');
  const bad = args.filter((a, i) => a.startsWith('--') && !known.has(a) && !(rootIdx >= 0 && i === rootIdx + 1));
  if (bad.length) { console.error(`unknown option: ${bad.join(' ')}`); process.exit(2); }
  if (args.includes('--vercel') && args.includes('--manifest-only')) { console.error('--vercel and --manifest-only cannot be combined'); process.exit(2); }
  const root = path.resolve(rootIdx >= 0 ? args[rootIdx + 1] : '.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'infra/environments.json'), 'utf8'));

  if (args.includes('--self-test')) {
    const results = selfTest(manifest);
    for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `self-test FAILED: ${failed} of ${results.length} checks did not behave` : `self-test passed: ${results.length} of ${results.length} fixtures behaved (drift is caught)`);
    process.exit(failed ? 1 : 0);
  }

  const workflows = readWorkflows(root);
  const errors = [
    ...checkLocal(manifest, scanSource(root), readEnvExample(root)),
    ...checkWorkflows(manifest, workflows),
  ];
  const warnings = warnLocal(manifest, scanMentions(root, manifest.variables.map((v) => v.name)));
  const vercelFile = path.join(root, 'vercel.json');
  let vercelJson = null;
  try { vercelJson = JSON.parse(fs.readFileSync(vercelFile, 'utf8')); } catch { /* reported by checkVercelConfig */ }
  errors.push(...checkVercelConfig(manifest, vercelJson));
  let yamlParse = null;
  try { yamlParse = (await import('yaml')).parse; } catch { /* optional: only parse-checks the workflows */ }
  if (yamlParse) errors.push(...checkWorkflowYaml(workflows, yamlParse));
  else warnings.push('workflow-yaml: the yaml package is not installed (run npm ci); workflow files were not parse-checked');
  if (args.includes('--vercel')) errors.push(...checkVercel(manifest, await fetchVercelRows()));
  warnings.forEach((w) => console.log(`! ${w}`));
  errors.forEach((e) => console.log(`✗ ${e}`));
  console.log(errors.length ? `${errors.length} problem(s)` : `✓ environments match the manifest${args.includes('--vercel') ? ' (including Vercel)' : ' (manifest only, no Vercel call)'}`);
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`env-check: ${e.message}`); process.exit(1); });
}
