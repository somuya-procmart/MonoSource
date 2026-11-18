import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db';
import { audit, CurrentCtx, Ctx, hashPassword, Perm, Public, verifyPassword } from '../common/security';
import { ADANI_LEVELS, ROLE_PRESETS } from '../common/roles';

class LoginDto {
  @IsString() tenant: string;
  @IsEmail() email: string;
  @IsString() password: string;
}
class CreateTenantDto {
  @Matches(/^[a-z0-9-]{2,40}$/) slug: string;
  @IsString() @Length(2, 120) name: string;
  @IsEmail() adminEmail: string;
  @IsString() @MinLength(10) adminPassword: string;
}
class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @Length(1, 120) name: string;
  @IsString() @MinLength(10) password: string;
  @IsString() roleKey: string;
  @IsOptional() @IsUUID() scopeNodeId?: string;
  @IsOptional() @IsIn(['staff', 'supplier']) kind?: 'staff' | 'supplier';
  @IsOptional() @IsUUID() supplierId?: string;
}
class AssignRoleDto {
  @IsString() roleKey: string;
  @IsOptional() @IsUUID() scopeNodeId?: string;
}

@Controller()
export class IdentityController {
  constructor(private db: Db, private jwt: JwtService) {}

  @Public()
  @Post('auth/login')
  async login(@Body() b: LoginDto) {
    const found = await this.db.platformTx(async (c) => {
      const r = await c.query(
        `SELECT u.id, u.tenant_id, u.password_hash, u.status, t.kind AS tenant_kind, t.status AS tenant_status
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug=$1 AND lower(u.email)=lower($2)`,
        [b.tenant, b.email],
      );
      return r.rows[0];
    });
    // Same error for unknown tenant, unknown user and wrong password.
    const ok = found && found.status === 'active' && found.tenant_status === 'active' &&
      (await verifyPassword(b.password, found.password_hash));
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    await this.db.tx({ tenantId: found.tenant_id }, (c) => audit(c, { tenantId: found.tenant_id, userId: found.id }, 'auth.login', 'user', found.id));
    const token = await this.jwt.signAsync({ sub: found.id, tid: found.tenant_id, plat: found.tenant_kind === 'platform' });
    return { token };
  }

  @Get('me')
  async me(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const u = await c.query(`SELECT id, email, name, kind FROM users WHERE id=$1`, [ctx.userId]);
      const t = await c.query(`SELECT slug, name, coalesce((config->>'demo')::boolean, false) AS demo FROM tenants WHERE id=$1`, [ctx.tenantId]);
      return { ...u.rows[0], tenant: t.rows[0], platform: ctx.platform, assignments: ctx.assignments };
    });
  }

  // ── platform: create customer ──
  @Perm('platform:admin')
  @Post('platform/tenants')
  async createTenant(@CurrentCtx() ctx: Ctx, @Body() b: CreateTenantDto) {
    return this.db.platformTx(async (c) => {
      const ex = await c.query(`SELECT 1 FROM tenants WHERE slug=$1`, [b.slug]);
      if (ex.rowCount) throw new ConflictException('Tenant slug already exists');
      const t = (await c.query(`INSERT INTO tenants(slug,name) VALUES ($1,$2) RETURNING id`, [b.slug, b.name])).rows[0];
      await c.query(`INSERT INTO tenant_policies(tenant_id) VALUES ($1)`, [t.id]);
      for (const l of ADANI_LEVELS)
        await c.query(`INSERT INTO org_level_types(tenant_id,key,label,rank) VALUES ($1,$2,$3,$4)`, [t.id, l.key, l.label, l.rank]);
      const roleIds: Record<string, string> = {};
      for (const [key, r] of Object.entries(ROLE_PRESETS))
        roleIds[key] = (await c.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES ($1,$2,$3,$4) RETURNING id`, [t.id, key, r.name, r.permissions])).rows[0].id;
      const u = (await c.query(
        `INSERT INTO users(tenant_id,email,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
        [t.id, b.adminEmail, 'Customer administrator', await hashPassword(b.adminPassword)],
      )).rows[0];
      await c.query(`INSERT INTO user_roles(tenant_id,user_id,role_id) VALUES ($1,$2,$3)`, [t.id, u.id, roleIds.customer_admin]);
      await audit(c, { tenantId: t.id, userId: ctx.userId }, 'tenant.created', 'tenant', t.id, { slug: b.slug, by_platform_tenant: ctx.tenantId });
      return { id: t.id, slug: b.slug };
    });
  }

  @Perm('platform:admin')
  @Get('platform/tenants')
  tenants() {
    return this.db.platformTx(async (c) => (await c.query(`SELECT id, slug, name, kind, status, created_at FROM tenants ORDER BY created_at`)).rows);
  }

  // ── users ──
  @Perm('users:read')
  @Get('users')
  users(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) =>
      (await c.query(
        `SELECT u.id, u.email, u.name, u.kind, u.status,
           coalesce(json_agg(json_build_object('role', r.key, 'scopeNodeId', ur.scope_node_id)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
         GROUP BY u.id ORDER BY u.email`)).rows);
  }

  @Perm('users:write')
  @Post('users')
  async createUser(@CurrentCtx() ctx: Ctx, @Body() b: CreateUserDto) {
    return this.db.tx(ctx, async (c) => {
      const role = (await c.query(`SELECT id FROM roles WHERE key=$1`, [b.roleKey])).rows[0];
      if (!role) throw new BadRequestException('Unknown role');
      if (b.scopeNodeId && !(await c.query(`SELECT 1 FROM org_nodes WHERE id=$1`, [b.scopeNodeId])).rowCount)
        throw new BadRequestException('Unknown scope node');
      if (b.kind === 'supplier' && !b.supplierId) throw new BadRequestException('supplierId required for supplier users');
      try {
        const u = (await c.query(
          `INSERT INTO users(tenant_id,email,name,password_hash,kind,supplier_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ctx.tenantId, b.email, b.name, await hashPassword(b.password), b.kind ?? 'staff', b.supplierId ?? null],
        )).rows[0];
        await c.query(`INSERT INTO user_roles(tenant_id,user_id,role_id,scope_node_id) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, u.id, role.id, b.scopeNodeId ?? null]);
        await audit(c, ctx, 'user.created', 'user', u.id, { email: b.email, role: b.roleKey, scopeNodeId: b.scopeNodeId ?? null });
        return { id: u.id };
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('Email already exists');
        throw e;
      }
    });
  }

  @Perm('users:write')
  @Post('users/:id/roles')
  async assignRole(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: AssignRoleDto) {
    return this.db.tx(ctx, async (c) => {
      const role = (await c.query(`SELECT id FROM roles WHERE key=$1`, [b.roleKey])).rows[0];
      if (!role) throw new BadRequestException('Unknown role');
      if (!(await c.query(`SELECT 1 FROM users WHERE id=$1`, [id])).rowCount) throw new NotFoundException();
      await c.query(`INSERT INTO user_roles(tenant_id,user_id,role_id,scope_node_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ctx.tenantId, id, role.id, b.scopeNodeId ?? null]);
      await audit(c, ctx, 'user.role_assigned', 'user', id, b);
      return { ok: true };
    });
  }

  @Perm('users:read')
  @Get('roles')
  roles(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT key, name, permissions FROM roles ORDER BY key`)).rows);
  }

  @Perm('audit:read')
  @Get('audit')
  auditLog(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT id, actor_id, action, entity_type, entity_id, detail, at FROM audit_log ORDER BY id DESC LIMIT 200`)).rows);
  }
}
