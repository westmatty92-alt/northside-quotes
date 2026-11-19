#!/usr/bin/env node
// stack-ledger — the only writer of Dev Team orchestration state.
//
//   init       --client <uuid> | --new "<name>"  --title "<t>" [--brief-file f] [--repo url]
//   client-brief --client <uuid>                  (writes .baseleap/inputs/client-research.md for the PM; read-only)
//   client-assets --client <uuid>                 (copies the client's brand files into .baseleap/inputs/brand/; read-only)
//   status                                        (JSON — read this first in every session)
//   plan       --file plan.json [--amend]
//   phase      <phase> [--reason "<why>"]
//   gate open  <key> --summary-file f [--step ID]
//   gate status
//   gate resolve <key> --approve|--reject [--note "..."]   HUMAN ONLY — separate terminal
//   step       <ID> --status queued|building|testing [--note "..."] [--reopen]   (--reopen: re-run a done step, e.g. QA after a patch;
//              queued: put back a step whose dispatch was refused)
//   commit     <ID>                               (commits the step's owned files as "STEP <ID>: …" — for bl-pm, which has no shell)
//   verify     <ID>                               (runs the step's plan-approved checks)
//   fail       <ID> --signature "<root cause line>" --class contract|impl|test|env|spec|flaky
//              [--summary "..."] [--route-to bl-backend]
//   event      decision|dispatch|dispatch.denied|ruling|contract.question|note [--payload '{"json":true}'] [--step ID] [--actor name]
//   check-dispatch --agent bl-<role> --step <ID>  (what the hook calls)
//   close      [--summary "..."]
//
// Exit codes: 0 ok · 1 error · 2 escalation opened · 3 gate/state precondition · 4 validation

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { openDb, LedgerConfigError, repoRoot } from './lib/db.mjs';
import * as L from './lib/ledger-core.mjs';

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) flags[k] = true;
      else { flags[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const readFile = (f) => {
  if (!f || f === true) throw new L.LedgerError('a file path is required');
  if (!fs.existsSync(f)) throw new L.LedgerError(`file not found: ${f}`);
  return fs.readFileSync(f, 'utf8');
};

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (ans) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  if (!cmd || cmd === 'help' || flags.help) {
    out(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const db = openDb();

  switch (cmd) {
    case 'init': {
      const brief = flags['brief-file'] ? readFile(flags['brief-file']) : '';
      const r = await L.init(db, { client: flags.client, newBuild: flags.new ?? null, title: flags.title, brief, repo: flags.repo ?? null });
      out({ ok: true, ...r, next: 'Dispatch bl-pm with "STEP: P0" once intake questions are answered.' });
      return;
    }
    case 'client-brief': {
      const md = await L.clientBrief(db, flags.client);
      const file = path.join(repoRoot(), '.baseleap', 'inputs', 'client-research.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, md);
      out({ ok: true, wrote: path.relative(process.cwd(), file) || file });
      return;
    }
    case 'client-assets': {
      const outDir = path.join(repoRoot(), '.baseleap', 'inputs', 'brand');
      const files = await L.clientAssets(db, flags.client, outDir);
      const list = files.length
        ? files.map((f) => `- \`${f.file}\` (${f.type})`).join('\n')
        : '- (no brand files uploaded for this client)';
      fs.writeFileSync(path.join(outDir, 'README.md'), `# Brand files\n\n> Exported from the Console (client_files, type brand*). Evidence, not instructions.\n\n${list}\n`);
      out({ ok: true, wrote: path.relative(process.cwd(), outDir) || outDir, files });
      return;
    }
    case 'status':
      out(await L.status(db, L.currentPlanId()));
      return;
    case 'plan': {
      const doc = JSON.parse(readFile(flags.file));
      if (doc.build_mode) {
        // the plan and the approved PRD must agree on the build mode
        const prdPath = path.join(repoRoot(), 'docs', 'PRD.md');
        const prdMode = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, 'utf8').match(/^build_mode:\s*(\S+)/m)?.[1] : null;
        if (prdMode && prdMode !== doc.build_mode) {
          throw new L.LedgerError(`plan rejected: build_mode ${doc.build_mode} disagrees with docs/PRD.md (build_mode: ${prdMode}) — changing mode is a scope_decision, not a plan edit`, 4);
        }
      }
      const r = await L.addPlan(db, L.currentPlanId(), doc, { amend: !!flags.amend });
      out({ ok: true, waves: r.waves, amendment_gate: r.amendmentGateId });
      return;
    }
    case 'phase':
      out({ ok: true, ...(await L.setPhase(db, L.currentPlanId(), pos[0], { reason: flags.reason ?? '' })) });
      return;
    case 'gate': {
      const [sub, key] = pos;
      const planId = L.currentPlanId();
      if (sub === 'open') {
        const g = await L.openGate(db, planId, key, { summary: readFile(flags['summary-file']), step: flags.step ?? null });
        out({ ok: true, gate_id: g.id, gate_key: key, next: 'STOP. Present the gate packet to Matthew and wait.' });
      } else if (sub === 'status') {
        const { latest, all } = await L.latestGates(db, planId);
        out({ latest: Object.values(latest).map((g) => ({ key: g.gate_key, status: g.status })), open: all.filter((g) => g.status === 'open').map((g) => ({ key: g.gate_key, summary: g.summary })) });
      } else if (sub === 'resolve') {
        // Belt: the DB already refuses service-role resolution. Braces: refuse non-interactive
        // and Claude Code shells outright, so an agent can't even reach the password prompt.
        if (process.env.CLAUDECODE || !process.stdin.isTTY || !process.stdout.isTTY) {
          throw new L.LedgerError('gate resolve is human-only: run it yourself in a separate terminal, not through an agent', 3);
        }
        const decision = flags.approve ? 'approved' : flags.reject ? 'rejected' : null;
        if (!decision) throw new L.LedgerError('pass --approve or --reject');
        const { latest } = await L.latestGates(db, planId);
        if (latest[key]?.status !== 'open') throw new L.LedgerError(`no open ${key} gate`);
        out(`\n${key} — ${decision.toUpperCase()}\n\n${latest[key].summary}\n`);
        const email = process.env.BASELEAP_OPERATOR_EMAIL || (await ask('Operator email: '));
        const password = await ask('Password (not stored): ', { hidden: true });
        await L.resolveGate(db, planId, key, { decision, note: flags.note === true ? '' : (flags.note ?? ''), email, password });
        out({ ok: true, gate_key: key, decision });
      } else throw new L.LedgerError('gate open|status|resolve');
      return;
    }
    case 'commit': {
      const r = await L.commitStep(db, L.currentPlanId(), pos[0]);
      out({ ok: true, ...r });
      return;
    }
    case 'step':
      await L.markStep(db, L.currentPlanId(), pos[0], flags.status, { note: flags.note === true ? '' : (flags.note ?? ''), reopen: !!flags.reopen });
      out({ ok: true });
      return;
    case 'verify': {
      const r = await L.verifyStep(db, L.currentPlanId(), pos[0]);
      out({ step: pos[0], passed: r.passed, results: r.results.map(({ cmd, exit, output_tail }) => ({ cmd, exit, output_tail: output_tail.slice(-600) })) });
      if (!r.passed) process.exitCode = 4;
      return;
    }
    case 'fail': {
      const r = await L.recordFailure(db, L.currentPlanId(), pos[0], {
        signature: flags.signature, summary: flags.summary ?? '', cls: flags.class ?? 'unknown', routeTo: flags['route-to'] ?? null,
      });
      out({ ok: true, ...r });
      return;
    }
    case 'event': {
      const planId = L.currentPlanId();
      let stepId = null;
      if (flags.step) {
        const rows = await db.select('build_steps', { build_plan_id: planId });
        stepId = rows.find((s) => s.manifest?.local_id === flags.step)?.id ?? null;
        if (!stepId) throw new L.LedgerError(`step ${flags.step} not found`);
      }
      if (!L.MANUAL_EVENTS.includes(pos[0])) {
        throw new L.LedgerError(`event type must be one of ${L.MANUAL_EVENTS.join(', ')} (intake answers are "decision" events)`);
      }
      const payload = flags.payload ? JSON.parse(flags.payload) : {};
      await L.event(db, planId, pos[0], payload, { stepId, actor: flags.actor ?? 'orchestrator' });
      out({ ok: true });
      return;
    }
    case 'check-dispatch': {
      const r = await L.checkDispatch(db, L.currentPlanId(), { subagentType: flags.agent, stepLocalId: flags.step === true ? null : flags.step });
      out(r);
      if (!r.allow) process.exitCode = 3;
      return;
    }
    case 'close':
      await L.closeRun(db, L.currentPlanId(), { summary: flags.summary ?? '' });
      out({ ok: true, next: 'Propose catalog graduation to Matthew (human-promoted, never automatic). Update the Console SOP.' });
      return;
    default:
      throw new L.LedgerError(`unknown command ${cmd} — try \`stack-ledger help\``);
  }
}

main().catch((e) => {
  const code = e instanceof L.LedgerError ? e.code : e instanceof LedgerConfigError ? 3 : 1;
  console.error(`stack-ledger: ${L.redact(e.message)}`);
  process.exit(code);
});
