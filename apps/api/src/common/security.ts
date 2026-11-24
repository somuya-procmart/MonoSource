import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PoolClient } from 'pg';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { Db } from '../db/db';

// ── passwords (scrypt; dev-grade local auth, SSO adapters come in Phase 7) ──
export function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((res, rej) =>
    _scrypt(pw, salt, 64, (e, key) => (e ? rej(e) : res(`${salt.toString('hex')}:${key.toString('hex')}`))),
  );
}
export function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  return new Promise((res, rej) =>
    _scrypt(pw, Buffer.from(salt, 'hex'), 64, (e, key) =>
      e ? rej(e) : res(timingSafeEqual(key, Buffer.from(hash, 'hex'))),
    ),
  );
}

// ── permissions ──
export interface Assignment { perms: string[]; scopeNodeId: string | null }
export interface Ctx {
  userId: string;
  tenantId: string;
  kind: 'staff' | 'supplier';
  supplierId: string | null;
  assignments: Assignment[];
  platform: boolean;
}

export function permMatches(granted: string, needed: string): boolean {
  if (granted === '*' || granted === needed) return true;
  return granted.endsWith(':*') && needed.startsWith(granted.slice(0, -1));
}
export function hasPerm(ctx: Ctx, needed: string): boolean {
  return ctx.assignments.some((a) => a.perms.some((p) => permMatches(p, needed)));
}

/** Is `nodeId` inside the subtree of one of the scopes that grant `needed`? Whole-tenant grant = always. */
export async function canAtNode(c: PoolClient, ctx: Ctx, needed: string, nodeId: string): Promise<boolean> {
  const grants = ctx.assignments.filter((a) => a.perms.some((p) => permMatches(p, needed)));
  if (!grants.length) return false;
  if (grants.some((g) => g.scopeNodeId === null)) return true;
  const roots = grants.map((g) => g.scopeNodeId);
  const r = await c.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM org_nodes WHERE id = $1
       UNION ALL SELECT n.id, n.parent_id FROM org_nodes n JOIN up ON n.id = up.parent_id)
     SELECT 1 FROM up WHERE id = ANY($2::uuid[]) LIMIT 1`,
    [nodeId, roots],
  );
  return r.rowCount! > 0;
}

/** All node ids the user may see for a permission (null = unrestricted). */
export async function visibleNodeIds(c: PoolClient, ctx: Ctx, needed: string): Promise<string[] | null> {
  const grants = ctx.assignments.filter((a) => a.perms.some((p) => permMatches(p, needed)));
  if (grants.some((g) => g.scopeNodeId === null)) return null;
  const roots = grants.map((g) => g.scopeNodeId);
  if (!roots.length) return [];
  const r = await c.query(
    `WITH RECURSIVE down AS (
       SELECT id FROM org_nodes WHERE id = ANY($1::uuid[])
       UNION ALL SELECT n.id FROM org_nodes n JOIN down d ON n.parent_id = d.id)
     SELECT id FROM down`,
    [roots],
  );
  return r.rows.map((x) => x.id);
}

export const REQUIRE_PERM = 'require_perm';
export const Perm = (p: string) => SetMetadata(REQUIRE_PERM, p);
export const Public = () => SetMetadata('public', true);
export const CurrentCtx = createParamDecorator((_d, ec: ExecutionContext) => ec.switchToHttp().getRequest().ctx as Ctx);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private db: Db, private reflector: Reflector) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('public', [ec.getHandler(), ec.getClass()])) return true;
    const req = ec.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new UnauthorizedException();
    let claims: any;
    try { claims = await this.jwt.verifyAsync(h.slice(7)); } catch { throw new UnauthorizedException(); }
    // Long-lived MCP tokens only open the read-only MCP endpoint.
    if (claims.scope === 'mcp' && !String(req.path ?? req.url).startsWith('/mcp')) throw new ForbiddenException('This token only works for the MCP endpoint');

    // Permissions are re-read from the DB on every request, so revoking a role takes effect immediately.
    const ctx = await this.db.tx({ tenantId: claims.tid }, async (c) => {
      const u = await c.query(`SELECT kind, supplier_id, status FROM users WHERE id=$1`, [claims.sub]);
      if (!u.rowCount || u.rows[0].status !== 'active') throw new UnauthorizedException();
      const a = await c.query(
        `SELECT r.permissions, ur.scope_node_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id=$1`,
        [claims.sub],
      );
      const assignments = a.rows.map((x) => ({ perms: x.permissions, scopeNodeId: x.scope_node_id }));
      return {
        userId: claims.sub, tenantId: claims.tid, kind: u.rows[0].kind, supplierId: u.rows[0].supplier_id,
        assignments, platform: !!claims.plat && assignments.some((x) => x.perms.includes('platform:admin')),
      } as Ctx;
    });
    req.ctx = ctx;

    const needed = this.reflector.getAllAndOverride<string>(REQUIRE_PERM, [ec.getHandler(), ec.getClass()]);
    if (needed) {
      if (needed.startsWith('platform:') ? !ctx.platform : !hasPerm(ctx, needed)) throw new ForbiddenException(`Missing permission ${needed}`);
    }
    return true;
  }
}

export async function audit(
  c: PoolClient, ctx: Pick<Ctx, 'tenantId' | 'userId'> | { tenantId: string; userId: null },
  action: string, entityType?: string, entityId?: string, detail: any = {},
) {
  await c.query(
    `INSERT INTO audit_log(tenant_id, actor_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ctx.tenantId, ctx.userId, action, entityType ?? null, entityId ?? null, JSON.stringify(detail)],
  );
}
