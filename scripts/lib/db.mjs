// Storage adapters for the stack ledger.
//
//  - supabase (default): PostgREST over fetch, service-role key, operator stamped explicitly.
//  - memory:  JSON file, for the automated tests ONLY. Refuses to load unless
//             NODE_ENV=test, so an agent can't flip the ledger onto an editable file.
//
// No dependencies — Node 18+ (global fetch).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.baseleap')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

/** Loads KEY=VALUE lines from .env.local / .env without overriding the real environment. */
export function loadEnv(root = repoRoot()) {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const val = m[2].replace(/^['"]|['"]$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new LedgerConfigError(`missing ${name} (set it in .env.local — never commit it)`);
  return v;
}

export class LedgerConfigError extends Error {}

// ---------------------------------------------------------------------------
// Supabase / PostgREST
// ---------------------------------------------------------------------------
class SupabaseAdapter {
  constructor() {
    this.url = need('BASELEAP_LEDGER_URL').replace(/\/$/, '');
    this.key = need('BASELEAP_LEDGER_SERVICE_KEY');
    this.operatorId = need('BASELEAP_OPERATOR_ID');
  }

  headers(token = this.key) {
    return {
      apikey: token === this.key ? this.key : need('BASELEAP_LEDGER_ANON_KEY'),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  qs(filters = {}, { order, limit, columns } = {}) {
    const p = new URLSearchParams();
    if (columns) p.append('select', columns.join(','));   // ask only for what's needed (never secret columns)
    for (const [k, v] of Object.entries(filters)) {
      if (v === null) p.append(k, 'is.null');
      else if (Array.isArray(v)) p.append(k, `in.(${v.join(',')})`);
      else p.append(k, `eq.${v}`);
    }
    if (order) p.append('order', order);
    if (limit) p.append('limit', String(limit));
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  async req(method, table, { filters, body, opts, token } = {}) {
    const res = await fetch(`${this.url}/rest/v1/${table}${this.qs(filters, opts)}`, {
      method,
      headers: this.headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${table} failed (${res.status}): ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : [];
  }

  select(table, filters, opts) { return this.req('GET', table, { filters, opts }); }
  async insert(table, row) { return (await this.req('POST', table, { body: row }))[0]; }
  update(table, filters, patch) { return this.req('PATCH', table, { filters, body: patch }); }

  /** Downloads a private Storage object with the service key. Returns a Buffer. */
  async download(bucket, objectPath) {
    const url = `${this.url}/storage/v1/object/authenticated/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { headers: { apikey: this.key, Authorization: `Bearer ${this.key}` } });
    if (!res.ok) throw new Error(`download ${bucket}/${objectPath} failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Human-only path: signs in with the operator's own password and patches as that user. */
  async updateAsUser(table, filters, patch, { email, password }) {
    const anon = need('BASELEAP_LEDGER_ANON_KEY');
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) throw new Error(`sign-in failed: ${json.error_description || json.msg || res.status}`);
    return this.req('PATCH', table, { filters, body: patch, token: json.access_token });
  }
}

// ---------------------------------------------------------------------------
// Memory (tests only)
// ---------------------------------------------------------------------------
class MemoryAdapter {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new LedgerConfigError('memory adapter is for automated tests only (NODE_ENV=test)');
    }
    this.file = need('BL_LEDGER_MEMORY_FILE');
    this.operatorId = process.env.BASELEAP_OPERATOR_ID || '00000000-0000-0000-0000-00000000000a';
  }
  load() {
    return fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { build_plans: [], build_steps: [], stack_gates: [], stack_events: [], clients: [] };
  }
  save(db) { fs.writeFileSync(this.file, JSON.stringify(db, null, 2)); }
  match(row, filters = {}) {
    return Object.entries(filters).every(([k, v]) =>
      v === null ? row[k] == null : Array.isArray(v) ? v.includes(row[k]) : String(row[k]) === String(v));
  }
  async select(table, filters, { order, columns } = {}) {
    let rows = (this.load()[table] ?? []).filter((r) => this.match(r, filters));
    if (columns) rows = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
    if (order) {
      const [col, dir] = order.split('.');
      rows = rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    return rows;
  }
  async insert(table, row) {
    const db = this.load();
    const now = new Date().toISOString();
    const full = table === 'stack_events'
      ? { id: db.stack_events.length + 1, created_at: now, ...row }
      : { id: crypto.randomUUID(), created_at: now, ...(table === 'stack_gates' ? { status: 'open', requested_at: now } : {}), ...row };
    if (table === 'stack_gates' && full.status && full.status !== 'open') throw new Error('gates must be created open');
    db[table].push(full);
    this.save(db);
    return full;
  }
  async update(table, filters, patch) {
    if (table === 'stack_events') throw new Error('stack_events is append-only');
    const db = this.load();
    const out = [];
    db[table] = db[table].map((r) => {
      if (!this.match(r, filters)) return r;
      if (table === 'stack_gates' && patch.status && patch.status !== 'open') {
        throw new Error('gate can only be resolved by a signed-in operator');
      }
      const n = { ...r, ...patch };
      out.push(n);
      return n;
    });
    this.save(db);
    return out;
  }
  async download(bucket, objectPath) {
    // Test stand-in for Storage: files under <memory file dir>/storage/<bucket>/<path>.
    const p = path.join(path.dirname(this.file), 'storage', bucket, objectPath);
    if (!fs.existsSync(p)) throw new Error(`download ${bucket}/${objectPath} failed (404)`);
    return fs.readFileSync(p);
  }
  async updateAsUser(table, filters, patch) {
    // Test stand-in for a signed-in human session.
    const db = this.load();
    const out = [];
    db[table] = db[table].map((r) => (this.match(r, filters) ? (out.push({ ...r, ...patch }), { ...r, ...patch }) : r));
    this.save(db);
    return out;
  }
}

export function openDb() {
  loadEnv();
  return process.env.BL_LEDGER_ADAPTER === 'memory' ? new MemoryAdapter() : new SupabaseAdapter();
}
