#!/usr/bin/env node
// .github/scripts/release-preflight.mjs (owned by bl-devops). The release pre-flight: runs in the FIRST job of
// .github/workflows/release.yml, before the job that is bound to the `production` environment, and FAILS CLOSED. It reads no
// secret value and changes nothing; it only reads GitHub's own description of the `production` environment and one repository
// variable.
//
//   node .github/scripts/release-preflight.mjs              live check (needs GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, PRODUCTION_URL)
//   node .github/scripts/release-preflight.mjs --self-test   proves the check rejects each way production could be unprotected
//
// It fails unless ALL of these hold:
//   1. the run is for refs/heads/main;
//   2. the repository variable PRODUCTION_URL is set and is an https address;
//   3. `production` has a "required reviewers" protection rule that names every login/id in infra/environments.json
//      (github.production.requiredReviewers);
//   4. `can_admins_bypass` is exactly false (an answer that does not say is treated as "admins can bypass");
//   5. the deployment branch policy is "selected branches" and the only branches listed are the manifest's deploymentBranches
//      (["main"]); "all branches" and "protected branches only" both fail.
//
// APIs (read-only, version 2022-11-28):
//   GET /repos/{owner}/{repo}/environments/{environment_name}
//   GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies
// GitHub's "Permissions required for GitHub Apps" page lists both under *Repository permissions for "Actions": read* (installation
// access tokens included), and the environment page says "Anyone with read access to the repository can use this endpoint".
// So the workflow's own GITHUB_TOKEN with `permissions: actions: read` should be enough; the optional repository secret
// RELEASE_PREFLIGHT_TOKEN is the fallback only if GitHub answers 403 or 404 (see the message below and docs/runbook.md).
// UNVERIFIED (OPS1, Nov 27): the REST reference page for "Get an environment" lists protection_rules (type required_reviewers,
// with reviewers[].reviewer.login/id) and deployment_branch_policy, but does NOT list can_admins_bypass, although the API's
// environment object carries it (go-github's Environment type has it). No live call could be made from the session. If the field is
// ever absent from the real answer, this check fails closed ("does not say can_admins_bypass is false"); it never guesses.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const ENVIRONMENT = 'production';

// ---- the decision (pure; exercised by --self-test) ----------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.ref                 GITHUB_REF
 * @param {string} input.productionUrl       the PRODUCTION_URL repository variable ('' when unset)
 * @param {object|null} input.environment    parsed GET .../environments/production, or null when it could not be read
 * @param {object|null} input.branchPolicies parsed GET .../deployment-branch-policies, or null when it could not be read
 * @param {Array<string|number>} input.reviewers   manifest: logins and/or numeric ids that must be required reviewers
 * @param {string[]} input.branches          manifest: the only branches production may deploy from
 * @returns {string[]} problems (empty = pass)
 */
export function evaluate({ ref, productionUrl, environment, branchPolicies, reviewers, branches }) {
  const problems = [];

  if (ref !== 'refs/heads/main') problems.push(`The release runs only for refs/heads/main (this run is for "${ref || 'nothing'}").`);

  const url = String(productionUrl ?? '').trim();
  if (!url) problems.push('The repository variable PRODUCTION_URL is empty or not set (Settings > Secrets and variables > Actions > Variables). Nothing was deployed.');
  else {
    let parsed = null;
    try { parsed = new URL(url); } catch { /* reported below */ }
    if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname) problems.push('The repository variable PRODUCTION_URL must be an https:// address.');
  }

  if (!environment || typeof environment !== 'object') {
    problems.push(`The "${ENVIRONMENT}" environment could not be read, so its protection cannot be proven.`);
    return problems;
  }
  if (environment.name !== ENVIRONMENT) problems.push(`GitHub answered for environment "${environment.name}", not "${ENVIRONMENT}".`);

  // 3. required reviewers
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const reviewerRule = rules.find((r) => r && r.type === 'required_reviewers');
  if (!reviewerRule) problems.push(`The "${ENVIRONMENT}" environment has no "Required reviewers" protection rule: a release would start without waiting for an approval.`);
  else {
    const people = (Array.isArray(reviewerRule.reviewers) ? reviewerRule.reviewers : [])
      .filter((r) => r && r.type === 'User' && r.reviewer && typeof r.reviewer === 'object')
      .map((r) => r.reviewer);
    if (!reviewers.length) problems.push('infra/environments.json lists no required reviewer (github.production.requiredReviewers), so there is nothing to prove.');
    for (const want of reviewers) {
      const found = people.some((p) => (typeof want === 'number' ? p.id === want : String(p.login ?? '').toLowerCase() === String(want).toLowerCase()));
      if (!found) problems.push(`The required reviewers of "${ENVIRONMENT}" do not include ${typeof want === 'number' ? `user id ${want}` : want}.`);
    }
  }

  // 4. administrators cannot bypass
  if (environment.can_admins_bypass !== false) {
    problems.push(environment.can_admins_bypass === true
      ? `"Allow administrators to bypass configured protection rules" is ON for "${ENVIRONMENT}": turn it off.`
      : `GitHub's answer does not say can_admins_bypass is false for "${ENVIRONMENT}"; treated as ON.`);
  }

  // 5. deployment branches: selected branches, exactly the manifest's list
  const dbp = environment.deployment_branch_policy;
  if (!dbp || typeof dbp !== 'object') problems.push(`"${ENVIRONMENT}" deploys from ANY branch (deployment branch policy is none): limit it to ${branches.join(', ')}.`);
  else if (dbp.custom_branch_policies !== true || dbp.protected_branches !== false) {
    problems.push(`"${ENVIRONMENT}" deployment branches must be "Selected branches and tags" (${branches.join(', ')}); "All branches" and "Protected branches only" are not enough.`);
  } else if (!branchPolicies || !Array.isArray(branchPolicies.branch_policies)) {
    problems.push(`The deployment branch policies of "${ENVIRONMENT}" could not be read, so the branch limit cannot be proven.`);
  } else {
    const listed = branchPolicies.branch_policies;
    if (!listed.length) problems.push(`"${ENVIRONMENT}" has no deployment branch rule: add ${branches.join(', ')}.`);
    for (const p of listed) {
      if (!p || p.type === 'tag' || !branches.includes(p.name)) {
        problems.push(`"${ENVIRONMENT}" allows deployments from ${p && p.type === 'tag' ? 'tag' : 'branch'} pattern "${p ? p.name : '?'}", which is not one of: ${branches.join(', ')}.`);
      }
    }
    for (const b of branches) {
      if (!listed.some((p) => p && p.name === b && p.type !== 'tag')) problems.push(`"${ENVIRONMENT}" does not allow deployments from ${b}.`);
    }
  }

  return problems;
}

// ---- reading GitHub (read-only) -------------------------------------------------------------------------------------

async function getJson(path, token) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, 'User-Agent': 'release-preflight' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { status: 0, body: null };
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

function unreadable(label, status) {
  const hint = status === 403 || status === 404
    ? ' GitHub refused the workflow token (it cannot read environment protection rules). Fix: create a fine-grained, read-only token for this repository only, with repository permission "Actions: Read", and store it as the repository secret RELEASE_PREFLIGHT_TOKEN (docs/runbook.md, Release pre-flight). Nothing was deployed.'
    : ' Nothing was deployed.';
  return `Could not read ${label} (HTTP ${status || 'no answer'}).${hint}`;
}

function readManifest() {
  const m = JSON.parse(fs.readFileSync('infra/environments.json', 'utf8'));
  const p = m?.github?.production ?? {};
  return { reviewers: Array.isArray(p.requiredReviewers) ? p.requiredReviewers : [], branches: Array.isArray(p.deploymentBranches) ? p.deploymentBranches : [] };
}

async function live() {
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, PRODUCTION_URL } = process.env;
  const problems = [];
  if (!GH_TOKEN) problems.push('No token reached the pre-flight (GH_TOKEN is empty).');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? '')) problems.push('GITHUB_REPOSITORY is not owner/name.');
  let manifest = { reviewers: [], branches: [] };
  try { manifest = readManifest(); } catch { problems.push('infra/environments.json could not be read.'); }
  if (!manifest.branches.length) problems.push('infra/environments.json lists no deploymentBranches for production.');

  let environment = null;
  let branchPolicies = null;
  if (!problems.length) {
    const base = `/repos/${GITHUB_REPOSITORY}/environments/${ENVIRONMENT}`;
    const env = await getJson(base, GH_TOKEN);
    if (env.status === 200) environment = env.body;
    else problems.push(unreadable(`the "${ENVIRONMENT}" environment`, env.status));
    if (environment?.deployment_branch_policy?.custom_branch_policies === true) {
      const pol = await getJson(`${base}/deployment-branch-policies?per_page=100`, GH_TOKEN);
      if (pol.status === 200) branchPolicies = pol.body;
      else problems.push(unreadable(`the "${ENVIRONMENT}" deployment branch policies`, pol.status));
    }
  }
  problems.push(...evaluate({ ref: GITHUB_REF ?? '', productionUrl: PRODUCTION_URL ?? '', environment, branchPolicies, reviewers: manifest.reviewers, branches: manifest.branches }));
  return [...new Set(problems)];
}

// ---- self-test ------------------------------------------------------------------------------------------------------

export function selfTest() {
  const results = [];
  const expect = (label, ok) => results.push({ label, ok });
  const reviewers = ['westmatty92-alt'];
  const branches = ['main'];
  const good = () => ({
    ref: 'refs/heads/main',
    productionUrl: 'https://example.invalid',
    reviewers,
    branches,
    environment: {
      name: 'production',
      can_admins_bypass: false,
      protection_rules: [
        { id: 1, type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'westmatty92-alt', id: 4242 } }] },
        { id: 2, type: 'branch_policy' },
      ],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    },
    branchPolicies: { total_count: 1, branch_policies: [{ id: 9, name: 'main', type: 'branch' }] },
  });
  const run = (mutate) => { const c = good(); mutate(c); return evaluate(c); };
  const fails = (label, mutate, re) => expect(label, run(mutate).some((p) => re.test(p)));

  expect('a fully protected production environment passes', evaluate(good()).length === 0);
  expect('the reviewer is matched case-insensitively', evaluate({ ...good(), reviewers: ['WestMatty92-ALT'] }).length === 0);
  expect('the reviewer can be named by numeric id', evaluate({ ...good(), reviewers: [4242] }).length === 0);
  fails('a numeric id that is not a reviewer fails', (c) => { c.reviewers = [999]; }, /user id 999/);
  fails('no required-reviewers rule fails', (c) => { c.environment.protection_rules = [{ id: 2, type: 'branch_policy' }]; }, /no "Required reviewers"/);
  fails('an empty protection_rules fails', (c) => { c.environment.protection_rules = []; }, /no "Required reviewers"/);
  fails('protection_rules missing entirely fails', (c) => { delete c.environment.protection_rules; }, /no "Required reviewers"/);
  fails('a different reviewer fails', (c) => { c.environment.protection_rules[0].reviewers[0].reviewer = { login: 'someone-else', id: 1 }; }, /do not include westmatty92-alt/);
  fails('a Team reviewer with the right name fails (only users count)', (c) => { c.environment.protection_rules[0].reviewers = [{ type: 'Team', reviewer: { name: 'westmatty92-alt', id: 4242 } }]; }, /do not include/);
  fails('a rule with no reviewers fails', (c) => { c.environment.protection_rules[0].reviewers = []; }, /do not include/);
  fails('an empty manifest reviewer list fails', (c) => { c.reviewers = []; }, /lists no required reviewer/);
  fails('admin bypass ON fails', (c) => { c.environment.can_admins_bypass = true; }, /bypass.*ON/);
  fails('can_admins_bypass missing fails (treated as ON)', (c) => { delete c.environment.can_admins_bypass; }, /does not say can_admins_bypass is false/);
  fails('can_admins_bypass as the string "false" fails', (c) => { c.environment.can_admins_bypass = 'false'; }, /does not say/);
  fails('no deployment branch policy (any branch) fails', (c) => { c.environment.deployment_branch_policy = null; }, /ANY branch/);
  fails('protected branches only fails', (c) => { c.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }; }, /Selected branches/);
  fails('both flags true fails', (c) => { c.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: true }; }, /Selected branches/);
  fails('a wildcard branch rule fails', (c) => { c.branchPolicies.branch_policies = [{ name: '*', type: 'branch' }]; }, /pattern "\*"/);
  fails('main plus another branch fails', (c) => { c.branchPolicies.branch_policies.push({ name: 'staging', type: 'branch' }); }, /pattern "staging"/);
  fails('a tag rule named main fails', (c) => { c.branchPolicies.branch_policies = [{ name: 'main', type: 'tag' }]; }, /tag pattern "main"/);
  fails('selected branches with an empty list fails', (c) => { c.branchPolicies.branch_policies = []; }, /no deployment branch rule/);
  fails('unreadable branch policies fail', (c) => { c.branchPolicies = null; }, /deployment branch policies of "production" could not be read/);
  fails('an unreadable environment fails', (c) => { c.environment = null; }, /could not be read/);
  fails('an answer for another environment fails', (c) => { c.environment.name = 'staging'; }, /not "production"/);
  fails('an empty PRODUCTION_URL fails', (c) => { c.productionUrl = ''; }, /PRODUCTION_URL is empty/);
  fails('a blank PRODUCTION_URL fails', (c) => { c.productionUrl = '   '; }, /PRODUCTION_URL is empty/);
  fails('an unset PRODUCTION_URL fails', (c) => { c.productionUrl = undefined; }, /PRODUCTION_URL is empty/);
  fails('an http PRODUCTION_URL fails', (c) => { c.productionUrl = 'http://example.invalid'; }, /https/);
  fails('a PRODUCTION_URL that is not a URL fails', (c) => { c.productionUrl = 'northside-quotes.vercel.app'; }, /https/);
  fails('a run for another branch fails', (c) => { c.ref = 'refs/heads/staging'; }, /only for refs\/heads\/main/);
  fails('a run for a tag fails', (c) => { c.ref = 'refs/tags/v1'; }, /only for refs\/heads\/main/);
  return results;
}

// ---- CLI ------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const results = selfTest();
    for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `self-test FAILED: ${failed} of ${results.length} checks did not behave` : `self-test passed: ${results.length} of ${results.length} cases behaved (every unprotected setup is rejected)`);
    process.exit(failed ? 1 : 0);
  }
  if (args.length) { console.error(`unknown option: ${args.join(' ')}`); process.exit(2); }

  const problems = await live();
  const lines = problems.length
    ? ['### Release pre-flight: FAILED (nothing was deployed or migrated)', ...problems.map((p) => `- ${p}`)]
    : ['### Release pre-flight: passed', `- \`${ENVIRONMENT}\` has the required reviewer, administrators cannot bypass, it deploys only from main, and PRODUCTION_URL is set.`];
  for (const p of problems) console.log(`::error::${p.replace(/[\r\n]+/g, ' ')}`);
  if (!problems.length) console.log('Release pre-flight passed: reviewer rule, no admin bypass, main-only deployments, PRODUCTION_URL set.');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
