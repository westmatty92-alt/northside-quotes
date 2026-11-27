#!/usr/bin/env node
// .github/scripts/staging-db-check.mjs (owned by bl-devops). Diagnoses SUPABASE_STAGING_DB_URL in CI without ever printing it.
//
//   node .github/scripts/staging-db-check.mjs              checks the value in the environment and probes it with psql
//   node .github/scripts/staging-db-check.mjs --self-test  fixtures: every suspected cause, and "no secret reaches the output"
//
// Reads SUPABASE_STAGING_DB_URL (secret) and SUPABASE_STAGING_REF (a variable, not secret).
//
// WHAT IS PRINTED: yes/no answers and fixed words only (scheme: postgres/postgresql/other; host class; port number only when it is
// 1 to 5 digits; booleans). WHAT IS NEVER PRINTED: the value, the user, the password, the host, the database name, the query string,
// and psql's stderr (libpq puts the host, the address and sometimes the user in its messages, so stderr is classified by pattern
// and then dropped). Parsing is done by position, never with `new URL()`, so a password holding @ / ? # [ ] or % cannot break it
// or end up in an error message of the parser.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EXPECTED_REGION = 'ca-central-1'; // docs/runbook.md: both Supabase projects live here
const SSL_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Facts about the value, all booleans or fixed words. Nothing in the result is a substring of the input. */
export function inspect(raw, stagingRef) {
  const value = typeof raw === 'string' ? raw : '';
  const trimmed = value.trim();
  const facts = {
    empty: trimmed.length === 0,
    leadingWhitespace: /^\s/.test(value),
    trailingWhitespace: /\s$/.test(value),
    newline: /[\r\n]/.test(value),
    innerWhitespace: /\s/.test(trimmed),
    scheme: 'none',
    hostClass: 'other',
    port: 'default',
    hasUser: false,
    hasPassword: false,
    passwordIsPlaceholder: false,
    passwordNeedsEncoding: false,
    dbIsPostgres: false,
    userIsStagingRef: 'unknown',
    userIsPlainPostgres: false,
    regionMatches: false,
    sslmode: 'not set',
  };
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(trimmed);
  if (!schemeMatch) return facts;
  const scheme = schemeMatch[1].toLowerCase();
  facts.scheme = scheme === 'postgres' || scheme === 'postgresql' ? scheme : 'other';

  const rest = trimmed.slice(schemeMatch[0].length);
  // The host part is what follows the LAST "@": a password that holds an unencoded "@" cannot move the host.
  const at = rest.lastIndexOf('@');
  const userinfo = at < 0 ? '' : rest.slice(0, at);
  const tail = at < 0 ? rest : rest.slice(at + 1);

  const hostEnd = tail.search(/[/?#]/);
  const hostPort = hostEnd < 0 ? tail : tail.slice(0, hostEnd);
  const afterHost = hostEnd < 0 ? '' : tail.slice(hostEnd);
  let host = hostPort;
  let portText = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    host = close < 0 ? hostPort : hostPort.slice(1, close);
    portText = close < 0 ? '' : hostPort.slice(close + 1).replace(/^:/, '');
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon >= 0) {
      host = hostPort.slice(0, colon);
      portText = hostPort.slice(colon + 1);
    }
  }
  host = host.toLowerCase();
  if (/\.pooler\.supabase\.com$/.test(host)) facts.hostClass = 'pooler';
  else if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host)) facts.hostClass = 'direct';
  facts.regionMatches = facts.hostClass === 'pooler' && host.includes(EXPECTED_REGION);
  facts.port = portText === '' ? 'default' : /^\d{1,5}$/.test(portText) ? portText : 'invalid';

  const pathAndQuery = afterHost.replace(/#.*$/, '');
  const queryStart = pathAndQuery.indexOf('?');
  const path = queryStart < 0 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
  const query = queryStart < 0 ? '' : pathAndQuery.slice(queryStart + 1);
  facts.dbIsPostgres = safeDecode(path.replace(/^\//, '')) === 'postgres';
  for (const part of query.split('&')) {
    const m = /^sslmode=(.*)$/i.exec(part);
    if (m) facts.sslmode = SSL_MODES.has(m[1].toLowerCase()) ? m[1].toLowerCase() : 'invalid';
  }

  const colon = userinfo.indexOf(':');
  const user = colon < 0 ? userinfo : userinfo.slice(0, colon);
  const password = colon < 0 ? '' : userinfo.slice(colon + 1);
  facts.hasUser = user.length > 0;
  facts.hasPassword = password.length > 0;
  facts.passwordIsPlaceholder = /^\[?your-?password\]?$/i.test(safeDecode(password));
  // RFC 3986 userinfo: unreserved, sub-delims, ":" and %XX. Anything else (@ / ? # [ ] space ...), or a lone %, belongs in
  // percent-encoded form. libpq cuts the address at an unencoded "@" or "/", and rejects a lone "%".
  facts.passwordNeedsEncoding = /[^A-Za-z0-9\-._~!$&'()*+,;=:%]/.test(password) || /%(?![0-9A-Fa-f]{2})/.test(password);
  const decodedUser = safeDecode(user);
  facts.userIsPlainPostgres = decodedUser === 'postgres';
  const ref = (stagingRef ?? '').trim();
  facts.userIsStagingRef = ref === '' ? 'unknown' : decodedUser === `postgres.${ref}` ? 'yes' : 'no';
  return facts;
}

const yn = (b) => (b ? 'yes' : 'no');

/** The lines of the diagnosis. Fixed wording and the facts above only. */
export function renderFacts(f) {
  const hostLabel = { pooler: '*.pooler.supabase.com (Session or Transaction pooler)', direct: 'db.*.supabase.co (DIRECT, IPv6 only)', other: 'other' }[f.hostClass];
  return [
    'SUPABASE_STAGING_DB_URL diagnosis (classes and yes/no only; the value, user, password and host are never printed)',
    `  leading or trailing whitespace: ${yn(f.leadingWhitespace || f.trailingWhitespace)}`,
    `  newline anywhere in the value: ${yn(f.newline)}`,
    `  whitespace inside the value: ${yn(f.innerWhitespace)}`,
    `  scheme: ${f.scheme}`,
    `  host class: ${hostLabel}`,
    `  port: ${f.port === 'default' ? 'not given (libpq default 5432)' : f.port}`,
    `  password field present: ${yn(f.hasPassword)}`,
    `  password is still the [YOUR-PASSWORD] placeholder: ${yn(f.passwordIsPlaceholder)}`,
    `  password has characters that need percent-encoding:${yn(f.passwordNeedsEncoding)}`,
    `  database name is postgres: ${yn(f.dbIsPostgres)}`,
    `  user is postgres.<SUPABASE_STAGING_REF>: ${f.userIsStagingRef}`,
    `  pooler region is ${EXPECTED_REGION}: ${f.hostClass === 'pooler' ? yn(f.regionMatches) : 'n/a'}`,
    `  sslmode in the string: ${f.sslmode}${f.sslmode === 'not set' ? ' (libpq default "prefer" works with Supabase)' : ''}`,
  ];
}

/** Maps psql's result to a short class. The stderr text is read here and nowhere else; it is never returned or printed. */
export function classifyProbe({ status, error, stderr }) {
  if (error && error.code === 'ENOENT') return 'nopsql';
  if (error && (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM')) return 'timeout';
  if (status === 0) return 'ok';
  const t = String(stderr ?? '').toLowerCase();
  const has = (...needles) => needles.some((n) => t.includes(n));
  if (has('tenant or user not found')) return 'tenant';
  if (has('no password supplied')) return 'nopassword';
  if (has('password authentication failed', 'authentication failed', 'scram')) return 'auth';
  if (has('max clients reached', 'maxclientsinsessionmode', 'too many connections', 'remaining connection slots', 'emaxconn')) return 'busy';
  if (has('could not translate host name', 'name or service not known', 'temporary failure in name resolution', 'nodename nor servname', 'no address associated with hostname', 'address family for hostname not supported')) return 'dns';
  if (has('network is unreachable', 'no route to host', 'cannot assign requested address')) return 'network';
  if (has('connection refused')) return 'refused';
  if (has('timeout expired', 'timed out')) return 'timeout';
  if (has('ssl', 'certificate', 'pg_hba.conf')) return 'ssl';
  if (has('invalid uri', 'invalid percent-encoded', 'invalid connection option', 'missing "=" after', 'invalid port number', 'invalid integer value', 'unterminated quoted', 'invalid uri query parameter')) return 'invalid';
  if (/database "[\s\S]*" does not exist/.test(t)) return 'database';
  return 'other';
}

const CLASS_LABEL = {
  ok: 'connected',
  nopsql: 'psql is not installed',
  dns: 'could not translate host name',
  network: 'network unreachable (IPv6?)',
  auth: 'password authentication failed',
  tenant: 'pooler does not know this user or project ("Tenant or user not found")',
  nopassword: 'no password supplied',
  busy: 'too many connections (pooler or database limit)',
  refused: 'connection refused',
  timeout: 'connection timed out',
  ssl: 'SSL',
  invalid: 'the string is not a valid connection address',
  database: 'database does not exist',
  other: 'other',
};

const RUNBOOK = 'docs/runbook.md, section "Staging database address for CI"';
const FIX = `Fix: ${RUNBOOK}.`;

/** Plain-language errors for Matthew: the first line is the main one, the rest are additional problems the facts show. */
export function verdict(facts, cls) {
  const main = [];
  const hints = [];
  const direct = facts.hostClass === 'direct';
  switch (cls) {
    case 'dns':
    case 'network':
    case 'timeout':
    case 'refused':
      if (direct) {
        main.push('SUPABASE_STAGING_DB_URL points at the direct db.<ref> host (IPv6 only), which GitHub runners cannot reach. Use the Session pooler string (host contains pooler.supabase.com, port 5432).');
      } else if (cls === 'dns') {
        main.push('The host name in SUPABASE_STAGING_DB_URL does not resolve. Check the host for a typo or a stray character, and use the Session pooler string (host contains pooler.supabase.com).');
      } else if (cls === 'network') {
        main.push('The host in SUPABASE_STAGING_DB_URL is not reachable from the GitHub runner (network unreachable, often an IPv6-only address). Use the Session pooler string (host contains pooler.supabase.com, port 5432).');
      } else {
        main.push('The runner could not connect to the host and port in SUPABASE_STAGING_DB_URL (refused or timed out). Check the port is 5432 and the host is the Session pooler of the staging project.');
      }
      break;
    case 'tenant':
      main.push('The pooler does not know the user or project in SUPABASE_STAGING_DB_URL. The user must be postgres.<the staging project ref> (the value of SUPABASE_STAGING_REF), and the host must be the pooler of the region the staging project lives in. Copy the Session pooler string again from the staging project.');
      break;
    case 'auth':
      main.push('The database refused the password in SUPABASE_STAGING_DB_URL. It does not match the staging project\'s current database password (it may have been reset), or it was typed or encoded wrongly. Reset it in Supabase and paste the Session pooler string with the new password.');
      break;
    case 'nopassword':
      main.push('SUPABASE_STAGING_DB_URL has no password. Replace [YOUR-PASSWORD] in the Session pooler string with the staging database password before saving it.');
      break;
    case 'busy':
      main.push('The staging database or its pooler has no free connection slot right now (the Session pooler limits clients). Wait for other runs to finish and re-run; if it repeats, report it, since it is not a wrong secret.');
      break;
    case 'ssl':
      main.push('The SSL handshake with the staging database failed. Remove any sslmode setting you added to SUPABASE_STAGING_DB_URL (or set sslmode=require), and use the Session pooler string.');
      break;
    case 'invalid':
      main.push('SUPABASE_STAGING_DB_URL is not a valid connection address. Look for a space or newline in it, or a password with special characters that is not percent-encoded.');
      break;
    case 'database':
      main.push('The database name in SUPABASE_STAGING_DB_URL does not exist. It must end in /postgres.');
      break;
    case 'nopsql':
      main.push('psql is not installed on this runner image. This is a CI problem, not a secret problem; tell bl-devops.');
      break;
    default:
      main.push('psql could not connect to the staging database for a reason this check does not recognise. The message is not printed on purpose (it can hold the address). Try the same psql command from your own machine with the same string to read it.');
  }
  // Facts that are wrong whatever the class: each one is a thing to fix.
  if (facts.leadingWhitespace || facts.trailingWhitespace || facts.newline) hints.push('The saved value has leading or trailing whitespace or a newline. Paste it again with nothing before or after it (no Enter at the end).');
  else if (facts.innerWhitespace) hints.push('The saved value has a space inside it. A connection address has no spaces; check the password for one and percent-encode it (%20), or remove it.');
  if (facts.scheme === 'none' || facts.scheme === 'other') hints.push('The value does not start with postgresql:// (or postgres://). Paste the whole Session pooler string.');
  if (!facts.hasPassword && cls !== 'nopassword') hints.push('There is no password field in the address (postgresql://user:password@host...). Add the staging database password.');
  if (facts.passwordIsPlaceholder) hints.push('The password is still the text [YOUR-PASSWORD]. Replace it with the real staging database password in the box you paste into, before copying.');
  else if (facts.passwordNeedsEncoding) hints.push('The password holds characters that break an address unless they are percent-encoded (such as @ / ? # [ ] or a space). Encode them, or reset the database password to letters and digits only.');
  if (facts.port !== 'default' && facts.port !== '5432') hints.push(`The port is ${facts.port === 'invalid' ? 'not a number' : facts.port}. The Session pooler uses 5432 (6543 is the Transaction pooler; the tests need the Session pooler).`);
  if (facts.hostClass === 'pooler' && !facts.regionMatches) hints.push(`The pooler host is not in ${EXPECTED_REGION}, where both Supabase projects live. Copy the string from the staging project's Connect panel.`);
  if (facts.hostClass === 'pooler' && facts.userIsStagingRef === 'no') hints.push('The user is not postgres.<SUPABASE_STAGING_REF>. A pooler address needs the project ref after "postgres." in the user; check it is the staging project\'s string, not production\'s.');
  if (facts.hostClass === 'direct' && cls !== 'dns' && cls !== 'network' && cls !== 'timeout' && cls !== 'refused') hints.push('The host is the direct db.<ref> address (IPv6 only). Use the Session pooler string (host contains pooler.supabase.com).');
  if (facts.hostClass === 'other') hints.push('The host is neither *.pooler.supabase.com nor db.*.supabase.co. Use the Session pooler string.');
  if (!facts.dbIsPostgres && facts.scheme !== 'none') hints.push('The database name is not postgres. The address must end in /postgres.');
  if (facts.sslmode === 'disable') hints.push('The string says sslmode=disable. Remove it.');
  return { main, hints };
}

/** Runs the probe. The URL goes as one argument (as the tests do); output is captured, classified and discarded. */
export function runProbe(url) {
  const result = spawnSync('psql', [url, '-w', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', 'select 1'], {
    encoding: 'utf8',
    timeout: 45000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
  });
  return { status: result.status, error: result.error, stderr: result.stderr };
}

/** Returns { lines, errors, warnings, code }. `probe` is injectable so the self-test never needs a database. */
export function diagnose(env, probe = runProbe) {
  const raw = env.SUPABASE_STAGING_DB_URL;
  const facts = inspect(raw, env.SUPABASE_STAGING_REF);
  const lines = renderFacts(facts);
  const errors = [];
  const warnings = [];
  if (facts.empty) {
    return { lines, errors: ['SUPABASE_STAGING_DB_URL is empty or not set in the GitHub staging environment.'], warnings, code: 1 };
  }
  const result = probe(raw);
  const cls = classifyProbe(result);
  lines.push(`  probe: psql "$SUPABASE_STAGING_DB_URL" -c 'select 1' -> ${cls === 'ok' ? 'exit 0' : `exit ${result.status ?? 'none'}`}, ${CLASS_LABEL[cls]}`);
  const v = verdict(facts, cls);
  if (cls === 'ok') {
    for (const hint of v.hints) warnings.push(`The connection works, but: ${hint}`);
    return { lines, errors, warnings, code: 0 };
  }
  errors.push(`${v.main[0]} ${FIX}`);
  for (const hint of v.hints) errors.push(hint);
  return { lines, errors, warnings, code: 1 };
}

function main() {
  const out = diagnose(process.env);
  for (const line of out.lines) console.log(line);
  for (const w of out.warnings) console.log(`::warning::${w}`);
  for (const e of out.errors) console.log(`::error::${e}`);
  process.exitCode = out.code;
}

// ---------------------------------------------------------------------------------------------------------------- self-test

function selfTest() {
  let failed = 0;
  let count = 0;
  const check = (name, condition) => {
    count += 1;
    if (!condition) {
      failed += 1;
      console.log(`  FAIL: ${name}`);
    }
  };
  const REF = 'abcdefghijklmnopqrst';
  const POOLER = 'aws-0-ca-central-1.pooler.supabase.com';
  const good = `postgresql://postgres.${REF}:Sup3rSecret@${POOLER}:5432/postgres`;

  // 1. facts for each suspected cause
  let f = inspect(good, REF);
  check('good: scheme', f.scheme === 'postgresql');
  check('good: pooler, region, port, password, db, user', f.hostClass === 'pooler' && f.regionMatches && f.port === '5432' && f.hasPassword && f.dbIsPostgres && f.userIsStagingRef === 'yes');
  check('good: no whitespace, no encoding problem', !f.leadingWhitespace && !f.trailingWhitespace && !f.newline && !f.innerWhitespace && !f.passwordNeedsEncoding && !f.passwordIsPlaceholder);

  f = inspect(`${good}\n`, REF);
  check('trailing newline is seen', f.trailingWhitespace && f.newline);
  f = inspect(` ${good}`, REF);
  check('leading space is seen', f.leadingWhitespace && !f.newline);
  f = inspect(`postgresql://postgres:Sup3rSecret@db.${REF}.supabase.co:5432/postgres`, REF);
  check('direct host is classed direct', f.hostClass === 'direct' && f.userIsPlainPostgres && f.userIsStagingRef === 'no');
  f = inspect(`postgresql://postgres.${REF}:x@${POOLER}:6543/postgres`, REF);
  check('transaction pooler port 6543 is reported', f.port === '6543');
  f = inspect(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@${POOLER}:5432/postgres`, REF);
  check('placeholder password is seen', f.passwordIsPlaceholder && f.hasPassword);
  f = inspect(`postgresql://postgres.${REF}@${POOLER}:5432/postgres`, REF);
  check('missing password field is seen', !f.hasPassword && f.hasUser);
  f = inspect(`postgresql://postgres.${REF}:@${POOLER}:5432/postgres`, REF);
  check('empty password is "no password"', !f.hasPassword);
  f = inspect(`postgresql://postgres.${REF}:pw@${POOLER}:5432/other`, REF);
  check('other database name is seen', !f.dbIsPostgres);
  f = inspect(`postgresql://postgres.${REF}:pw@${POOLER}/postgres?sslmode=require`, REF);
  check('default port and sslmode are read', f.port === 'default' && f.sslmode === 'require');
  f = inspect(`postgresql://postgres.${REF}:pw@${POOLER}:abc/postgres`, REF);
  check('a port that is not a number is "invalid"', f.port === 'invalid');
  f = inspect(`mysql://u:p@${POOLER}:5432/postgres`, REF);
  check('other scheme', f.scheme === 'other');
  f = inspect('host=example.com user=u password=p dbname=postgres', REF);
  check('keyword string is "none"', f.scheme === 'none' && !f.hasPassword);
  f = inspect('', REF);
  check('empty value', f.empty);
  f = inspect(undefined, REF);
  check('undefined value', f.empty);
  f = inspect(`postgresql://postgres.${REF}:pw@db2.example.com:5432/postgres`, REF);
  check('other host', f.hostClass === 'other');
  f = inspect(`postgresql://postgres.${REF}:pw@evil.pooler.supabase.com.attacker.example:5432/postgres`, REF);
  check('lookalike host is not a pooler', f.hostClass === 'other');
  f = inspect(`postgresql://postgres.${REF}:pw@${POOLER}:5432/postgres`, '');
  check('no SUPABASE_STAGING_REF gives "unknown"', f.userIsStagingRef === 'unknown');

  // 2. special characters in the password cannot break the parse
  for (const [name, pw] of [
    ['at sign', 'p@ss'],
    ['slash', 'p/ss'],
    ['question mark', 'p?ss'],
    ['hash', 'p#ss'],
    ['brackets', 'p[a]ss'],
    ['space', 'p ss'],
    ['lone percent', 'p%ss'],
    ['all together', 'a@b/c?d#e:f[g]h i%j'],
  ]) {
    f = inspect(`postgresql://postgres.${REF}:${pw}@${POOLER}:5432/postgres`, REF);
    check(`password with ${name}: host, port, database still parse`, f.hostClass === 'pooler' && f.port === '5432' && f.dbIsPostgres && f.hasPassword && f.userIsStagingRef === 'yes');
    check(`password with ${name}: flagged for percent-encoding`, f.passwordNeedsEncoding);
  }
  f = inspect(`postgresql://postgres.${REF}:p%40ss%2Fw%23rd@${POOLER}:5432/postgres`, REF);
  check('an already percent-encoded password is not flagged', !f.passwordNeedsEncoding && f.hostClass === 'pooler');
  f = inspect(`postgresql://postgres.${REF}:p!$&'()*+,;=-._~x@${POOLER}:5432/postgres`, REF);
  check('allowed punctuation is not flagged', !f.passwordNeedsEncoding);

  // 3. probe classes
  const cases = [
    [{ status: 2, stderr: 'psql: error: could not translate host name "x" to address: Name or service not known' }, 'dns'],
    [{ status: 2, stderr: 'psql: error: connection to server at "h" (2600:1f11::1), port 5432 failed: Network is unreachable' }, 'network'],
    [{ status: 2, stderr: 'psql: error: connection to server at "h" (3.1.2.3), port 5432 failed: FATAL:  password authentication failed for user "u"' }, 'auth'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: FATAL:  Tenant or user not found' }, 'tenant'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: fe_sendauth: no password supplied' }, 'nopassword'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: SSL error: certificate verify failed' }, 'ssl'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: server does not support SSL, but SSL was required' }, 'ssl'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: Connection refused' }, 'refused'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: timeout expired' }, 'timeout'],
    [{ status: 2, stderr: 'psql: error: invalid percent-encoded token: "%zz"' }, 'invalid'],
    [{ status: 2, stderr: 'psql: error: missing "=" after "bar" in connection info string' }, 'invalid'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: FATAL:  database "postgres\n" does not exist' }, 'database'],
    [{ status: 2, stderr: 'psql: error: connection to server failed: FATAL:  MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size' }, 'busy'],
    [{ status: 2, stderr: 'something nobody expects' }, 'other'],
    [{ status: 0, stderr: '' }, 'ok'],
    [{ status: null, error: { code: 'ENOENT' }, stderr: '' }, 'nopsql'],
    [{ status: null, error: { code: 'ETIMEDOUT' }, stderr: '' }, 'timeout'],
  ];
  for (const [input, expected] of cases) check(`classify "${String(input.stderr).slice(0, 40)}" -> ${expected}`, classifyProbe(input) === expected);

  // 4. what Matthew reads, for each suspected cause (the same fixtures the report shows)
  const run = (value, stderr, status = 2) => diagnose({ SUPABASE_STAGING_DB_URL: value, SUPABASE_STAGING_REF: REF }, () => ({ status, stderr }));
  let out = run(`postgresql://postgres:Sup3rSecret@db.${REF}.supabase.co:5432/postgres`, `psql: error: connection to server at "db.${REF}.supabase.co" (2600:1f18::1), port 5432 failed: Network is unreachable`);
  check('direct host + unreachable: names the IPv6 cause and the fix', out.code === 1 && out.errors[0].includes('direct db.<ref> host (IPv6 only)') && out.errors[0].includes('Use the Session pooler string'));
  out = run(`postgresql://postgres:Sup3rSecret@db.${REF}.supabase.co:5432/postgres`, `psql: error: could not translate host name "db.${REF}.supabase.co" to address: Address family for hostname not supported`);
  check('direct host + name not translated: names the IPv6 cause', out.code === 1 && out.errors[0].includes('direct db.<ref> host (IPv6 only)'));
  out = run(`${good}\n`, 'psql: error: connection to server failed: FATAL:  database "postgres\n" does not exist');
  check('trailing newline: says whitespace', out.code === 1 && out.errors.some((e) => e.includes('leading or trailing whitespace or a newline')));
  out = run(good, 'psql: error: connection to server failed: FATAL:  password authentication failed for user "x"');
  check('good shape + auth failure: says the password does not match', out.code === 1 && out.errors[0].includes('does not match') && out.errors.length === 1);
  out = run(`postgresql://postgres.${REF}:p@ss@${POOLER}:5432/postgres`, 'psql: error: connection to server failed: FATAL:  password authentication failed for user "x"');
  check('password with @ + auth failure: says percent-encoding', out.errors.some((e) => e.includes('percent-encoded')));
  out = run(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@${POOLER}:5432/postgres`, 'psql: error: connection to server failed: FATAL:  password authentication failed for user "x"');
  check('placeholder + auth failure: says [YOUR-PASSWORD]', out.errors.some((e) => e.includes('[YOUR-PASSWORD]')));
  out = run(`postgresql://postgres.${REF}:pw@${POOLER}:6543/postgres`, 'psql: error: connection to server failed: FATAL:  password authentication failed for user "x"');
  check('port 6543: says the Session pooler uses 5432', out.errors.some((e) => e.includes('5432')));
  out = run(good, 'psql: error: connection to server failed: SSL error: certificate verify failed');
  check('SSL class gets an SSL message', out.errors[0].includes('SSL'));
  out = run(good, '', 0);
  check('working string passes with exit 0 and no error', out.code === 0 && out.errors.length === 0 && out.warnings.length === 0);
  out = run(`postgresql://postgres:Sup3rSecret@db.${REF}.supabase.co:5432/postgres`, '', 0);
  check('direct host that connects passes with a warning', out.code === 0 && out.warnings.length > 0);
  out = diagnose({ SUPABASE_STAGING_DB_URL: '', SUPABASE_STAGING_REF: REF }, () => {
    throw new Error('the probe must not run for an empty value');
  });
  check('empty value stops before the probe', out.code === 1);

  // 5. nothing secret reaches the output, for hostile values, whatever psql says on stderr
  const secrets = ['Zq9-sentinel-pw', 'sentinel-user-7k', 'sentinel-host-4m.example.net', 'sentinel-db-3j'];
  const hostile = [
    `postgresql://${secrets[1]}:${secrets[0]}@${secrets[2]}:5432/${secrets[3]}`,
    `postgresql://${secrets[1]}:${secrets[0]}@${secrets[2]}:5432/${secrets[3]}\n`,
    `postgresql://${secrets[1]}:p@${secrets[0]}/x?#[ ]%@${secrets[2]}:5432/${secrets[3]}?sslmode=${secrets[0]}`,
    `postgresql://${secrets[1]}:${secrets[0]}@db.${secrets[3]}.supabase.co:${secrets[0]}/${secrets[3]}`,
    `${secrets[1]}:${secrets[0]}@${secrets[2]}/${secrets[3]}`,
    `postgresql://${secrets[1]}:${secrets[0]}@${secrets[2]}`,
  ];
  const stderrs = [
    `psql: error: connection to server at "${secrets[2]}" (1.2.3.4), port 5432 failed: FATAL:  password authentication failed for user "${secrets[1]}" ${secrets[0]}`,
    `psql: error: could not translate host name "${secrets[2]}" to address: Name or service not known`,
    `psql: error: invalid percent-encoded token: "${secrets[0]}"`,
    `psql: error: ${secrets[0]} ${secrets[1]} ${secrets[2]} ${secrets[3]} unknown failure`,
  ];
  let leaked = 0;
  let combos = 0;
  for (const value of hostile) {
    for (const stderr of stderrs) {
      for (const status of [2, 0]) {
        const r = diagnose({ SUPABASE_STAGING_DB_URL: value, SUPABASE_STAGING_REF: secrets[1] }, () => ({ status, stderr }));
        const text = [...r.lines, ...r.errors, ...r.warnings].join('\n');
        combos += 1;
        if (secrets.some((s) => text.includes(s)) || text.includes(value.trim())) leaked += 1;
      }
    }
  }
  check(`no secret part reaches the output (${combos} hostile combinations)`, leaked === 0);
  const facts = inspect(hostile[2], secrets[1]);
  check('facts hold only booleans and fixed words', Object.values(facts).every((x) => typeof x === 'boolean' || ['postgres', 'postgresql', 'other', 'none', 'pooler', 'direct', 'default', 'invalid', 'yes', 'no', 'unknown', 'not set', 'require'].includes(x) || /^\d{1,5}$/.test(x)));

  if (failed > 0) {
    console.log(`self-test FAILED: ${failed} of ${count} checks`);
    process.exitCode = 1;
    return;
  }
  console.log(`self-test passed: ${count} of ${count} checks (every suspected cause is named; no value, user, password or host reaches the output)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
