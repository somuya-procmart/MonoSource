/** Prints EXPLAIN (ANALYZE, BUFFERS) for every SQL statement one search runs. npx tsx scripts/adani/explain-search.ts "mcb 32a"  (uses DATABASE_ADMIN_URL) */
import { Pool } from 'pg';
import { DEFAULT_ADMIN_URL } from '../../src/db/db';
import { searchCatalogue } from '../../src/catalogue/search';
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL }); const c: any = await p.connect();
  // As the API does: inside a transaction, tenant set locally (works as monosource_app through the transaction pooler too).
  await c.query('BEGIN'); await c.query(`SELECT set_config('app.platform','on',true)`);
  const t = (await c.query(`SELECT id FROM tenants WHERE slug='adani'`)).rows[0].id;
  await c.query(`SELECT set_config('app.platform','off',true), set_config('app.tenant_id',$1,true)`, [t]);
  console.log('user', (await c.query('SELECT current_user')).rows[0].current_user);
  const q0 = c.query.bind(c);
  c.query = async (sql: any, params?: any) => {
    if (typeof sql === 'string' && /ms_search_candidates/.test(sql)) {
      const plan = (await q0('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' + sql, params)).rows.map((r: any) => r['QUERY PLAN']);
      console.log(plan.filter((l: string) => /actual time|Buffers|Execution|Planning/.test(l)).slice(0, 40).join('\n'));
    }
    return q0(sql, params);
  };
  await searchCatalogue(c, process.argv[2] ?? 'mcb 32a', { limit: 50 });
  await c.query('COMMIT'); c.release(); await p.end();
})();
