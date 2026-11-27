// @vitest-environment node
// The plan of the list query on the STAGING database (docs/architecture.md "Key queries and their indexes", be-data section 5).
// public.list_quote_requests() is a SQL function with a CTE, so a plain EXPLAIN of a call shows only a Function Scan; the plans
// below are of the function's own SELECT with the parameters written as literals, plus the timing of the real function call.
// The data is the PRD's year of volume (2,400 submitted requests) inserted INSIDE a transaction that is rolled back, so staging
// keeps nothing and no other session ever sees the rows. The plans are printed (console.info) for the report.
//   Newest first (no filter), the status filter (each Pipeline column) and a keyset page must be served by the partial inbox
//   indexes with no Sort node and no sequential scan of quote_requests. Search is a filtered scan by design (no index).
import { describe, expect, it } from 'vitest';
import { psqlOutput } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

setupStaging(); // loads and checks the staging variables (fails, never skips, when they are missing)

const ROWS = 2400;

const SELECT_LIST = 'select r.id, r.reference, r.name, r.urgency, r.status, r.submitted_at, r.version';

/** The body of list_quote_requests() with its parameters as literals (the text is the same as the migration's). */
function listSql(args: { status: string | null; q: string | null; afterAt: string | null; afterId: string | null; limit: number }): string {
  const text = (value: string | null, type: string) => (value === null ? `null::${type}` : `'${value}'::${type}`);
  return `
  with params as (
    select nullif(btrim(coalesce(${text(args.q, 'text')}, '')), '') as q,
           nullif(regexp_replace(coalesce(${text(args.q, 'text')}, ''), '[^0-9]', '', 'g'), '') as digits
  )
  ${SELECT_LIST}
    from public.quote_requests r
   cross join params x
   where r.state = 'submitted'
     and (${text(args.status, 'text')} is null or r.status = ${text(args.status, 'text')})
     and ((${text(args.afterAt, 'timestamptz')} is null and ${text(args.afterId, 'uuid')} is null)
          or (r.submitted_at, r.id) < (${text(args.afterAt, 'timestamptz')}, ${text(args.afterId, 'uuid')}))
     and (x.q is null
          or r.reference = upper(x.q)
          or strpos(lower(r.name), lower(x.q)) > 0
          or (char_length(x.digits) >= 3 and strpos(r.phone, x.digits) > 0))
   order by r.submitted_at desc, r.id desc
   limit ${args.limit}`;
}

const explain = (sql: string) => `explain (analyze, buffers, costs on, timing on)${sql};`;

/** A cursor in the middle of the data: the plan rows are submitted from 1 to 2,400 minutes ago, so about 1,400 rows are older than this. */
const MIDDLE = new Date(Date.now() - 1000 * 60_000).toISOString();

const CASES: Array<{ name: string; sql: string; indexed: boolean }> = [
  { name: 'newest first, first page of 50 (Requests tab, no filter)', sql: listSql({ status: null, q: null, afterAt: null, afterId: null, limit: 51 }), indexed: true },
  { name: 'status filter, first page of 50 (a Pipeline column)', sql: listSql({ status: 'quoted', q: null, afterAt: null, afterId: null, limit: 51 }), indexed: true },
  {
    name: 'keyset page: the rows after a cursor, 50 of them',
    sql: listSql({ status: null, q: null, afterAt: MIDDLE, afterId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', limit: 51 }),
    indexed: true,
  },
  {
    name: 'keyset page inside a status filter',
    sql: listSql({ status: 'won', q: null, afterAt: MIDDLE, afterId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', limit: 51 }),
    indexed: true,
  },
  { name: 'search by part of a name (filtered scan, no index by design)', sql: listSql({ status: null, q: 'plan test 12', afterAt: null, afterId: null, limit: 51 }), indexed: false },
  { name: 'search by reference', sql: listSql({ status: null, q: 'NQ-ZZZAAA', afterAt: null, afterId: null, limit: 51 }), indexed: false },
  { name: 'search by phone digits', sql: listSql({ status: null, q: '(444) 444-0042', afterAt: null, afterId: null, limit: 51 }), indexed: false },
];

describe(`the list query at ${ROWS} submitted requests (a year of volume), inside a rolled-back transaction`, () => {
  it('is served by the partial inbox indexes with no sort and no sequential scan; search is a filtered scan; all in a few milliseconds', () => {
    const script = `
      begin;
      set local statement_timeout = '60s';
      insert into public.quote_requests
        (id, submission_key, state, reference, name, phone, email, address, problem, urgency, status, status_changed_at, submitted_at, marketing_consent, photo_count)
      select gen_random_uuid(), gen_random_uuid(), 'submitted',
             'NQ-ZZZ' || substr(a.alpha, (g / 961) % 31 + 1, 1) || substr(a.alpha, (g / 31) % 31 + 1, 1) || substr(a.alpha, g % 31 + 1, 1),
             'Plan Test ' || g, lpad(g::text, 10, '4'), 'plan' || g || '@example.test', '14 Test Street, Hamilton ON',
             'The test tap drips constantly under the sink',
             (array['emergency', 'soon', 'flexible'])[g % 3 + 1],
             (array['new', 'quoted', 'won', 'lost'])[g % 4 + 1],
             case when g % 4 = 0 then null else now() - (g || ' minutes')::interval end,
             now() - (g || ' minutes')::interval, false, 0
        from generate_series(1, ${ROWS}) g
       cross join (select 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'::text as alpha) a;
      analyze public.quote_requests;
      select 'rows|' || count(*) from public.quote_requests where state = 'submitted';
      ${CASES.map((c) => `select '--- ${c.name}'; ${explain(c.sql)}`).join('\n      ')}
      select '--- the real function call: public.list_quote_requests(null, null, null, null, 51)';
      explain (analyze, buffers) select * from public.list_quote_requests(null, null, null, null, 51);
      select '--- the real function call with a status: public.list_quote_requests(''quoted'', null, null, null, 51)';
      explain (analyze, buffers) select * from public.list_quote_requests('quoted', null, null, null, 51);
      rollback;
    `;
    const output = psqlOutput(script);
    console.info(`\n${output}`);

    // the data really was there, and really is gone
    expect(output).toMatch(new RegExp(`^rows\\|(\\d+)$`, 'm'));
    const rows = Number(/^rows\|(\d+)$/m.exec(output)?.[1]);
    expect(rows).toBeGreaterThanOrEqual(ROWS);
    const left = psqlOutput(`select count(*) from public.quote_requests where name like 'Plan Test %';`).trim();
    expect(left).toBe('0');

    // split into one plan per case
    const sections = output.split(/^--- /m).slice(1);
    for (const c of CASES) {
      const plan = sections.find((s) => s.startsWith(c.name)) ?? '';
      expect(plan, c.name).not.toBe('');
      expect(plan, c.name).toContain('Execution Time');
      const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1]);
      expect(ms, `${c.name}: ${ms} ms`).toBeLessThan(250);
      if (c.indexed) {
        expect(plan, c.name).toMatch(/Index (Only )?Scan( Backward)? using quote_requests_(status_)?inbox_idx/);
        expect(plan, c.name).not.toMatch(/Seq Scan on quote_requests/);
        expect(plan, c.name).not.toMatch(/\bSort\b/);
      }
    }
  });
});
