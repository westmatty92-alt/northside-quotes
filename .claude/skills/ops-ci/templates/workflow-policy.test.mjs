// Run with: node --test tests/workflow-policy.test.mjs  (CI `workflows` job; vitest's include list does not cover .mjs here)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDir, checkWorkflow } from '../scripts/workflow-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/workflows');
const script = path.join(root, 'scripts/workflow-policy.mjs');

const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

test("today's workflows pass", () => {
  const { files, violations } = checkDir(path.join(root, '.github/workflows'));
  assert.ok(files.length >= 4, `expected at least four workflows, found ${files.join(', ')}`);
  assert.deepEqual(violations, []);
  const r = run(path.join(root, '.github/workflows'));
  assert.equal(r.status, 0, r.stderr);
});

const failing = [
  ['pull-request-target', /trigger "pull_request_target" is forbidden/],
  ['workflow-run', /trigger "workflow_run" is forbidden/],
  ['write-all', /write-all is forbidden/],
  ['workflow-level-write', /workflow-level permission "issues: write"/],
  ['job-write-not-allowed', /job: build .*write scope "pull-requests: write" is not in the allow-list/],
  ['release-disallowed-scope', /write scope "contents: write" is not in the allow-list for release\.yml/],
  ['secrets-inherit', /secrets: inherit/],
  ['injection', /github\.event\.pull_request\.title.*script injection/],
];

for (const [name, message] of failing) {
  test(`fixture ${name} fails with a clear message`, () => {
    const dir = path.join(fixtures, name);
    const r = run(dir);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message);
    assert.match(r.stderr, /ci\.yml|release\.yml/); // names the file
  });
}

for (const name of ['trigger-exception', 'allow-list-ok', 'injection-allowed']) {
  test(`fixture ${name} passes`, () => {
    const r = run(path.join(fixtures, name));
    assert.equal(r.status, 0, r.stderr);
  });
}

test('the allow-list is per file: issues: write is rejected outside uptime.yml', () => {
  const src = readFileSync(path.join(fixtures, 'allow-list-ok/uptime.yml'), 'utf8');
  assert.deepEqual(checkWorkflow('.github/workflows/uptime.yml', src), []);
  assert.equal(checkWorkflow('.github/workflows/ci.yml', src).length, 1);
});

test('a workflow with no workflow-level permissions fails', () => {
  const v = checkWorkflow('ci.yml', 'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n');
  assert.match(v[0].message, /no workflow-level "permissions"/);
});

test('an unreadable workflow fails closed', () => {
  const v = checkWorkflow('ci.yml', 'name: x\n  bad: [\n!!!\n');
  assert.ok(v.length >= 1);
});
