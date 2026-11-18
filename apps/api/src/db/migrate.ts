import { Client } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_ADMIN_URL } from './db';

/** Runs SQL migrations as the schema owner, then grants the runtime role (no BYPASSRLS). */
export async function migrate(adminUrl = process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
    const dir = join(__dirname, '..', '..', 'migrations');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log('applied', f);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const pw = process.env.APP_DB_PASSWORD || 'monosource_app_dev';
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monosource_app') THEN
        CREATE ROLE monosource_app LOGIN PASSWORD '${pw.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS;
      END IF; END $$`);
    await c.query(`GRANT USAGE ON SCHEMA public TO monosource_app`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO monosource_app`);
    await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO monosource_app`);
    await c.query(`REVOKE ALL ON schema_migrations FROM monosource_app`);
  } finally {
    await c.end();
  }
}

if (require.main === module) migrate().catch((e) => { console.error(e); process.exit(1); });
