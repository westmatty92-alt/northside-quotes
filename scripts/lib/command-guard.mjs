// command-guard.mjs: decides whether a shell command touches production, by what it does rather than its
// exact wording. Used by .claude/hooks/prod-guard.mjs (PreToolUse, Bash) for every session in the kit.
// Why: settings.json deny rules are prefix matches, so `vercel deploy --prebuilt --prod`,
// `npx --no-install supabase db push --remote=…` and `gh workflow run release.yml` slipped past them in
// the guardrail drill (Nov 2026). Production changes only ever happen in release.yml, after Matthew approves.

const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'timeout', 'xargs', 'stdbuf', 'nice']);
const RUNNERS = [['npx'], ['bunx'], ['pnpx'], ['pnpm', 'dlx'], ['pnpm', 'exec'], ['yarn', 'dlx'], ['yarn', 'exec'], ['npm', 'exec']];

/** Split a command line into simple commands (on ; && || | & newlines and inside $( ) / backticks / sh -c). */
export function simpleCommands(line) {
  const out = [];
  const inner = [];
  // pull out command substitutions and backticks, checked separately
  const stripped = String(line).replace(/\$\(([^()]*)\)|`([^`]*)`/g, (_, a, b) => { inner.push(a ?? b); return ' SUBST '; });
  for (const part of stripped.split(/\|\||&&|[;|&\n]/)) {
    const toks = tokenize(part);
    if (toks.length) out.push(toks);
  }
  for (const s of inner) out.push(...simpleCommands(s));
  // sh -c / bash -c "<script>"
  for (const toks of [...out]) {
    const i = toks.findIndex((t) => /^(?:.*\/)?(?:ba|z|da)?sh$/.test(t));
    if (i >= 0 && toks[i + 1] === '-c' && toks[i + 2]) out.push(...simpleCommands(toks[i + 2]));
  }
  return out;
}

function tokenize(s) {
  const toks = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) toks.push(m[1] ?? m[2] ?? m[3]);
  return toks;
}

/** Drop env assignments, wrappers and package runners so the real program comes first. */
export function program(toks) {
  let t = [...toks];
  for (let changed = true; changed && t.length; ) {
    changed = false;
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) { t.shift(); changed = true; }
    if (t.length && WRAPPERS.has(t[0].replace(/^.*\//, ''))) {
      t.shift(); changed = true;
      while (t.length && (t[0].startsWith('-') || /^\d+[smh]?$/.test(t[0]))) t.shift();
    }
    for (const r of RUNNERS) {
      if (r.every((w, i) => t[i] === w)) {
        t = t.slice(r.length); changed = true;
        while (t.length && t[0].startsWith('-')) t.shift();   // npx --no-install, -y, --yes…
        break;
      }
    }
  }
  if (t.length) t[0] = t[0].replace(/^.*\//, '').replace(/@[^/]*$/, ''); // ./node_modules/.bin/vercel, vercel@65
  return t;
}

const has = (t, ...words) => words.every((w) => t.includes(w));
const flag = (t, name) => t.some((x) => x === name || x.startsWith(`${name}=`));

/** Returns a reason string when the command must be refused, else null. */
export function refuse(line) {
  for (const raw of simpleCommands(line)) {
    const t = program(raw);
    const [cmd] = t;
    const args = t.slice(1);
    if (cmd === 'vercel') {
      if (flag(args, '--prod') || args.some((a) => /^--target=?production$/.test(a)) || (args.includes('--target') && args[args.indexOf('--target') + 1] === 'production'))
        return 'production Vercel deploys run only in release.yml after Matthew approves';
      if (['promote', 'rollback', 'alias', 'remove', 'rm', 'redeploy'].includes(args.find((a) => !a.startsWith('-'))))
        return `vercel ${args.find((a) => !a.startsWith('-'))} changes what production serves; only release.yml or Matthew does that`;
      if (args.includes('env') && args.some((a) => ['pull', 'add', 'rm', 'remove', 'update', 'ls'].includes(a)))
        return 'Vercel environment values are set by Matthew; agents never read or change them';
    }
    if (cmd === 'supabase') {
      if (has(args, 'db', 'push')) return 'database migrations reach a real project only through release.yml';
      if (has(args, 'db', 'reset') && (flag(args, '--linked') || flag(args, '--remote') || flag(args, '--db-url')))
        return 'resetting a remote database is never an agent action';
      if (has(args, 'migration', 'repair')) return 'migration history on a real project is repaired by Matthew';
      if (args.includes('secrets') && args.some((a) => ['set', 'unset'].includes(a))) return 'Supabase secrets are set by Matthew';
    }
    if (cmd === 'gh') {
      if (args[0] === 'workflow' && args[1] === 'run' && args.some((a) => /release/i.test(a)))
        return 'releases are started by Matthew (approval in GitHub or the Console), never by an agent';
      if (args[0] === 'secret' && args[1] !== 'list') return 'GitHub secrets are set by Matthew';
      if (args[0] === 'variable' && ['set', 'delete', 'remove'].includes(args[1])) return 'GitHub variables are set by Matthew';
      if (args[0] === 'api' && args.some((a) => /\/dispatches\b|\/deployments\/\d+\/statuses|environments\/production/.test(a)) && args.some((a) => /^(-X|--method)$/.test(a) || /^--method=/.test(a) || a === '-f' || a === '-F' || a === '--input'))
        return 'starting or approving deployments through the GitHub API is Matthew\'s';
      if (args[0] === 'run' && ['rerun', 'cancel'].includes(args[1])) return 'release runs are re-run or cancelled by Matthew';
    }
    if ((cmd === 'terraform' || cmd === 'tofu') && args.some((a) => ['apply', 'destroy', 'import'].includes(a)))
      return 'infrastructure changes are applied by Matthew';
    if (cmd === 'printenv') return 'environment values are never printed';
  }
  return null;
}
