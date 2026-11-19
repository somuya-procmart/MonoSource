/** Try the search engine from the terminal: npx tsx scripts/adani/try-search.ts "electrical cables" "mcb 32a"  (uses DATABASE_ADMIN_URL) */
import { Pool } from 'pg';
import { DEFAULT_ADMIN_URL } from '../../src/db/db';
import { searchCatalogue } from '../../src/catalogue/search';
const qs = process.argv.slice(2);
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL }); const c = await p.connect();
  const t = (await c.query(`SELECT id FROM tenants WHERE slug='adani'`)).rows[0].id; await c.query(`SELECT set_config('app.tenant_id',$1,false)`, [t]);
  for (const q of qs) { const t0 = Date.now(); const r = await searchCatalogue(c, q, { limit: 8 }); const ms = Date.now() - t0;
    const names = r.hits.length ? (await c.query(`SELECT id,name FROM catalogue_items WHERE id = ANY($1)`, [r.hits.map((h) => h.id)])).rows : [];
    console.log(`\n### ${q}  (${ms}ms, total ${r.total}, head=${r.understanding.head}, semantic=${r.understanding.semantic})\n types: ${r.types.slice(0, 5).map((t) => `${t.name}[${t.count}|${t.score}|${t.via}]`).join(', ')}`);
    for (const h of r.hits) console.log('  ', h.score, names.find((n) => n.id === h.id)?.name, h.why.join(','));
  }
  c.release(); await p.end();
})();
