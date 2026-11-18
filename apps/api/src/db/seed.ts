import { Db } from './db';
import { ensurePlatformAdmin } from './bootstrap';

// DEVELOPMENT ONLY. Never run against production; credentials come from env or are obviously fake.
(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed production');
  const db = new Db();
  await ensurePlatformAdmin(db, process.env.PLATFORM_ADMIN_EMAIL || 'platform@monosource.local', process.env.PLATFORM_ADMIN_PASSWORD || 'dev-platform-pass-1');
  console.log('platform admin ready (tenant slug "platform")');
  await db.onModuleDestroy();
})();
