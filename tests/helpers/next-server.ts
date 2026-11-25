// tests/helpers/next-server.ts: starts this checkout's production server (`next start`) on a free local port, for the tests
// that need the framework's own routing in front of the handlers (what an unknown path answers, what the proxy does to a POST).
// A handler called in-process never meets that layer, so these answers cannot be tested any other way.
//
// The server is the real build: when .next is missing or older than the source, `next build` runs first, so the test can
// never pass against a stale build. It runs with this process's environment (the staging variables when the file loaded
// them), NODE_ENV=production, and is stopped in the file's afterAll. Nothing is printed: the server's output is kept in
// memory and only its last lines go into a failure message (the app never writes a secret to its output).
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const ROOT = process.cwd();
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const BUILD_ID = join(ROOT, '.next', 'BUILD_ID');

/** The newest modification time under `dir` (milliseconds), skipping nothing: the source tree is small. */
function newest(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((latest, entry) => {
    const path = join(dir, entry.name);
    return Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }, 0);
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  return env;
}

/** Builds when there is no build or the source is newer than it. */
function ensureFreshBuild(): void {
  const sources = [newest(join(ROOT, 'src')), statSync(join(ROOT, 'next.config.ts')).mtimeMs];
  if (existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= Math.max(...sources)) return;
  const built = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: ROOT, env: childEnv(), encoding: 'utf8', timeout: 280_000 });
  if (built.status !== 0) throw new Error(`next build failed (exit ${String(built.status)}) while preparing the test server:\n${(built.stdout ?? '').split('\n').slice(-25).join('\n')}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export type NextServer = { url: string; stop: () => Promise<void> };

/** Start `next start` and wait until it answers. Call stop() in afterAll. */
export async function startNextServer(): Promise<NextServer> {
  ensureFreshBuild();
  const port = await freePort();
  const output: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  const url = `http://127.0.0.1:${port}`;
  const stop = async (): Promise<void> => {
    if (exited) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    });
  };

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited) throw new Error(`the test server exited before it was ready:\n${output.join('').split('\n').slice(-15).join('\n')}`);
    try {
      await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      return { url, stop };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await stop();
  throw new Error(`the test server did not answer within 30 s:\n${output.join('').split('\n').slice(-15).join('\n')}`);
}
