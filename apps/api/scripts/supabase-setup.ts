/**
 * One-time Supabase setup, after migrations have run (they run on every Vercel build).
 *
 *   DATABASE_ADMIN_URL=<session pooler URL> API_URL=https://<api>.vercel.app CRON_SECRET=<same as on Vercel> npm -w apps/api run supabase:setup
 *
 *  1. private Storage bucket for contract documents and product images (served only through the API)
 *  2. pg_cron job that calls <API_URL>/cron/tick every minute (outbox + supplier follow-ups; serverless has no timers)
 * Idempotent: safe to run again (e.g. after changing API_URL or CRON_SECRET).
 */
import { Client } from 'pg';

(async () => {
  const { DATABASE_ADMIN_URL: db, API_URL: api, CRON_SECRET: secret } = process.env;
  const bucket = process.env.STORAGE_BUCKET || 'monosource';
  if (!db || !api || !secret) throw new Error('Set DATABASE_ADMIN_URL, API_URL and CRON_SECRET');
  const c = new Client({ connectionString: db }); await c.connect();
  try {
    await c.query(`INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, false) ON CONFLICT (id) DO UPDATE SET public = false`, [bucket]);
    console.log(`storage bucket "${bucket}" ready (private)`);
    await c.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`); await c.query(`CREATE EXTENSION IF NOT EXISTS pg_net`);
    await c.query(`SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'monosource-tick'`);
    // The secret is stored in Supabase Vault, not in the cron command text.
    await c.query(`DELETE FROM vault.secrets WHERE name = 'monosource_cron_secret'`);
    await c.query(`SELECT vault.create_secret($1, 'monosource_cron_secret')`, [secret]);
    await c.query(`SELECT cron.schedule('monosource-tick', '* * * * *', $cmd$
      SELECT net.http_post(url := '${api.replace(/\/$/, '').replace(/'/g, "''")}/cron/tick',
        headers := jsonb_build_object('authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'monosource_cron_secret')),
        timeout_milliseconds := 30000) $cmd$)`);
    console.log(`pg_cron: ${api}/cron/tick every minute`);
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
