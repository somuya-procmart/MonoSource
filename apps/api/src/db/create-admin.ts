import { Db } from './db';
import { ensurePlatformAdmin } from './bootstrap';

/**
 * Production-safe: creates the first platform admin from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD.
 * No defaults, so nothing weak is ever created. Idempotent: an existing admin is left untouched
 * (changing the env password later does NOT change the stored password).
 */
(async () => {
  const email = process.env.PLATFORM_ADMIN_EMAIL; const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) { console.log('create-admin: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set, skipping'); return; }
  if (password.length < 12) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
  const db = new Db();
  try { await ensurePlatformAdmin(db, email, password); console.log(`create-admin: platform admin ${email} ready (organisation ID "platform")`); }
  finally { await db.onModuleDestroy(); }
})().catch((e) => { console.error(e); process.exit(1); });
