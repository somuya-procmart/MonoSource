import { Db } from './db';
import { hashPassword } from '../common/security';

/** Creates the internal "platform" tenant and its first platform admin (ProcMart operations). Idempotent. */
export async function ensurePlatformAdmin(db: Db, email: string, password: string) {
  await db.platformTx(async (c) => {
    let t = (await c.query(`SELECT id FROM tenants WHERE slug='platform'`)).rows[0];
    if (!t) t = (await c.query(`INSERT INTO tenants(slug,name,kind) VALUES ('platform','MonoSource Platform','platform') RETURNING id`)).rows[0];
    let r = (await c.query(`SELECT id FROM roles WHERE tenant_id=$1 AND key='platform_admin'`, [t.id])).rows[0];
    if (!r) r = (await c.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES ($1,'platform_admin','Platform administrator','{platform:admin,users:read}') RETURNING id`, [t.id])).rows[0];
    let u = (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2`, [t.id, email])).rows[0];
    if (!u) {
      u = (await c.query(`INSERT INTO users(tenant_id,email,name,password_hash) VALUES ($1,$2,'Platform administrator',$3) RETURNING id`, [t.id, email, await hashPassword(password)])).rows[0];
      await c.query(`INSERT INTO user_roles(tenant_id,user_id,role_id) VALUES ($1,$2,$3)`, [t.id, u.id, r.id]);
    }
  });
}
