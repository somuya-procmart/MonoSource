/**
 * npm run demo — rebuilds the DEV database from scratch and loads the illustrative demo world.
 * DESTRUCTIVE for the dev database (drops schema "public"). Refuses to run in production.
 */
import 'reflect-metadata';
import { Client } from 'pg';
import { migrate } from '../src/db/migrate';
import { DEFAULT_ADMIN_URL } from '../src/db/db';
import { createApp } from '../src/main';
import { Db } from '../src/db/db';
import { ensurePlatformAdmin } from '../src/db/bootstrap';
import { OutboxService } from '../src/outbox/outbox.service';
import { FollowUpService } from '../src/buying/followups.service';
import { seedDemo, ACCOUNTS, PW } from './demo/seed';

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to run in production');
  process.env.OUTBOX_WORKER = 'off'; process.env.RATE_LIMIT = '100000';
  const adminUrl = process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL;
  const c = new Client({ connectionString: adminUrl }); await c.connect(); await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  await migrate(adminUrl);
  const app = await createApp(); await app.listen(0); const url = await app.getUrl();
  await ensurePlatformAdmin(app.get(Db), 'platform@monosource.local', 'dev-platform-pass-1');
  await seedDemo(url.replace('[::1]', 'localhost'), adminUrl, { outbox: app.get(OutboxService), followUps: app.get(FollowUpService) });
  await app.close();
  console.log('\nSign in at tenant "demo" with password', PW); for (const [e, d] of ACCOUNTS) console.log('  ', e.padEnd(26), d);
})().catch((e) => { console.error(e); process.exit(1); });
