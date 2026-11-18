import { BadRequestException, Body, ConflictException, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, CurrentCtx, Ctx, Perm, visibleNodeIds } from '../common/security';

class ErpSystemDto {
  @IsString() @Length(1, 40) code: string;
  @IsString() name: string;
  @IsIn(['sap', 'ariba', 'oracle', 'procmart', 'mock-sap']) kind: string;
}
class OrgNodeDto {
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() levelType: string;
  @IsString() @Length(1, 60) code: string;
  @IsString() name: string;
  @IsOptional() @IsUUID() erpSystemId?: string;
}

/** Create-or-get a node. Identity = (level, ERP server, code); the same plant code on another server is a different plant. */
export async function upsertNode(
  c: PoolClient, tenantId: string,
  n: { parentId: string | null; level: string; code: string; name: string; erpSystemId: string | null; source: string },
) {
  const r = await c.query(
    `INSERT INTO org_nodes(tenant_id,parent_id,level_type,code,name,erp_system_id,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, level_type, coalesce(erp_system_id,'00000000-0000-0000-0000-000000000000'), code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, (xmax = 0) AS created, parent_id`,
    [tenantId, n.parentId, n.level, n.code, n.name, n.erpSystemId, n.source],
  );
  return r.rows[0] as { id: string; created: boolean; parent_id: string | null };
}

@Controller()
export class OrgController {
  constructor(private db: Db) {}

  @Perm('org:write')
  @Post('erp-systems')
  async createErp(@CurrentCtx() ctx: Ctx, @Body() b: ErpSystemDto) {
    return this.db.tx(ctx, async (c) => {
      try {
        const r = await c.query(`INSERT INTO erp_systems(tenant_id,code,name,kind) VALUES ($1,$2,$3,$4) RETURNING id`, [ctx.tenantId, b.code, b.name, b.kind]);
        await audit(c, ctx, 'erp_system.created', 'erp_system', r.rows[0].id, b);
        return r.rows[0];
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('ERP system code exists');
        throw e;
      }
    });
  }

  @Perm('org:read')
  @Get('erp-systems')
  erps(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT id, code, name, kind FROM erp_systems ORDER BY code`)).rows);
  }

  @Perm('org:write')
  @Post('org/nodes')
  async createNode(@CurrentCtx() ctx: Ctx, @Body() b: OrgNodeDto) {
    return this.db.tx(ctx, async (c) => {
      const lvl = (await c.query(`SELECT rank FROM org_level_types WHERE key=$1`, [b.levelType])).rows[0];
      if (!lvl) throw new BadRequestException('Unknown level type');
      if (b.parentId) {
        const p = (await c.query(`SELECT l.rank FROM org_nodes n JOIN org_level_types l ON l.tenant_id=n.tenant_id AND l.key=n.level_type WHERE n.id=$1`, [b.parentId])).rows[0];
        if (!p) throw new BadRequestException('Unknown parent');
        if (p.rank >= lvl.rank) throw new BadRequestException('Parent must be a higher level than the child');
      } else if (lvl.rank !== 1) throw new BadRequestException('Only the top level may have no parent');
      if ((b.levelType === 'plant' || b.levelType === 'company_code') && !b.erpSystemId)
        throw new BadRequestException(`${b.levelType} needs an ERP system (server) to be identified`);
      const n = await upsertNode(c, ctx.tenantId, { parentId: b.parentId ?? null, level: b.levelType, code: b.code, name: b.name, erpSystemId: b.erpSystemId ?? null, source: 'manual' });
      await audit(c, ctx, 'org_node.created', 'org_node', n.id, b);
      return { id: n.id };
    });
  }

  /**
   * CSV import in the shape of the Adani PO extract: BU, Server, Company code, Company name, Plant code, Plant name, Location.
   * Stands in for the SAP org-master sync until Adani IT agrees the method (decision Q9). Marked source=import.
   */
  @Perm('org:write')
  @Post('org/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async importOrg(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    let rows: any[];
    try { rows = parse(file.buffer, { columns: (h: string[]) => h.map((x) => x.trim()), skip_empty_lines: true, bom: true }); }
    catch { throw new BadRequestException('Not a valid CSV'); }
    for (const need of ['BU', 'Server', 'Company code', 'Plant code', 'Plant name'])
      if (!rows.length || !(need in rows[0])) throw new BadRequestException(`Missing column: ${need}`);
    return this.db.tx(ctx, async (c) => {
      const group = await upsertNode(c, ctx.tenantId, { parentId: null, level: 'group', code: 'GROUP', name: 'Group', erpSystemId: null, source: 'import' });
      const erpCache = new Map<string, string>();
      let created = 0;
      for (const r of rows) {
        const server = String(r['Server']).trim();
        if (!erpCache.has(server)) {
          const e = await c.query(
            `INSERT INTO erp_systems(tenant_id,code,name,kind) VALUES ($1,$2,$2,'sap')
             ON CONFLICT (tenant_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`, [ctx.tenantId, server]);
          erpCache.set(server, e.rows[0].id);
        }
        const erp = erpCache.get(server)!;
        const bu = await upsertNode(c, ctx.tenantId, { parentId: group.id, level: 'business', code: String(r['BU']).trim(), name: String(r['BU']).trim(), erpSystemId: null, source: 'import' });
        const cc = await upsertNode(c, ctx.tenantId, { parentId: bu.id, level: 'company_code', code: String(r['Company code']).trim(), name: String(r['Company name'] || r['Company code']).trim(), erpSystemId: erp, source: 'import' });
        const pl = await upsertNode(c, ctx.tenantId, { parentId: cc.id, level: 'plant', code: String(r['Plant code']).trim(), name: String(r['Plant name']).trim(), erpSystemId: erp, source: 'import' });
        created += +pl.created;
        if (r['Location']?.trim())
          await upsertNode(c, ctx.tenantId, { parentId: pl.id, level: 'delivery_point', code: `${r['Plant code'].trim()}:${r['Location'].trim()}`, name: r['Location'].trim(), erpSystemId: erp, source: 'import' });
      }
      await audit(c, ctx, 'org.imported', 'org', undefined, { rows: rows.length, newPlants: created });
      return { rows: rows.length, newPlants: created };
    });
  }

  @Perm('org:read')
  @Get('org/tree')
  async tree(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'org:read');
      const r = await c.query(
        `SELECT n.id, n.parent_id AS "parentId", n.level_type AS "levelType", n.code, n.name, e.code AS server, n.source
           FROM org_nodes n LEFT JOIN erp_systems e ON e.id=n.erp_system_id
          WHERE ($1::uuid[] IS NULL OR n.id = ANY($1)) ORDER BY n.level_type, n.code`, [vis]);
      return r.rows;
    });
  }
}
