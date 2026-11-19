import { ConflictException, BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { Storage } from '../storage/storage';
import { Res } from '@nestjs/common';
import { Response } from 'express';
import { Matches } from 'class-validator';
import { audit, canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { applicableLines } from '../contracts/coverage';
import { computeSources, SourceView } from './source';
import { searchCatalogue } from './search';
import { routeLines, vendorCodeSet } from '../buying/buying.controller';


/** Adds, for one plant, the contract coverage and the routing outcome ("how would this be bought now") to each item. */
export async function enrichItems(c: PoolClient, items: any[], plantId?: string | null) {
  const vendorOk = plantId ? await vendorCodeSet(c, plantId) : null;
  // Only supplies that can actually be ordered at this plant are shown as price/coverage in lists (the product page shows the rest with the reason).
  const cov = (plantId ? await applicableLines(c, plantId, items.map((i) => i.id), new Date().toISOString().slice(0, 10)) : []).filter((l) => !vendorOk || !l.supplier_id || vendorOk.has(l.supplier_id));
  const decisions = plantId ? await routeLines(c, plantId, items.map((i) => {
    const moqs = cov.filter((l) => l.item_id === i.id).map((l) => Number(l.moq ?? 1));
    return { item_id: i.id, qty: String(Math.max(1, ...(moqs.length ? [Math.min(...moqs)] : [1]))), uom: i.uom };
  })) : [];
  const sources = await computeSources(c, items.map((i) => i.id), plantId ?? null);
  const imgs = items.length ? (await c.query(`SELECT DISTINCT ON (item_id) item_id, id FROM item_assets WHERE item_id = ANY($1::uuid[]) AND kind='image' ORDER BY item_id, created_at`, [items.map((i) => i.id)])).rows : [];
  return items.map(({ search, ...i }, idx) => ({
    ...i,
    imageId: imgs.find((x) => x.item_id === i.id)?.id ?? null,
    source: sources.get(i.id) ? compactSource(sources.get(i.id)!) : null,
    routing: plantId ? { route: decisions[idx].route, model: decisions[idx].model, unitPrice: decisions[idx].unitPrice, reason: (decisions[idx].trace.at(-1)?.detail as any) ?? decisions[idx].trace.at(-1)?.outcome } : null,
    contractCoverage: cov.filter((l) => l.item_id === i.id).map((l) => ({
      contractLineId: l.contract_line_id, type: l.contract_type, contractNumber: l.contract_number, supplier: l.supplier_name,
      netPrice: l.net_price, uom: l.uom, validTo: l.valid_to, moq: l.moq,
    })),
  }));
}

export const compactSource = (v: SourceView) => ({ case: v.case, multiple: v.multiple, lowestPrice: v.lowestPrice, count: v.supplies.length,
  supplies: v.supplies.map((x) => ({ contractLineId: x.contractLineId, supplier: x.supplier, number: x.number, netPrice: x.netPrice, uom: x.uom, validTo: x.validTo, moq: x.moq })),
  elsewhere: v.elsewhere.slice(0, 3).map((x) => ({ supplier: x.supplier, number: x.number, netPrice: x.netPrice, appliesTo: x.appliesTo })), known: v.knownSuppliers.slice(0, 3).map((k) => k.name), alternatives: v.alternatives, request: v.request });

/** Image/PDF magic-byte check: the declared type is never trusted. SVG is refused (script risk). */
export function sniffAsset(buf: Buffer): { mime: string; kind: 'image' | 'document' } | null {
  if (buf.length > 4 && buf.subarray(0, 4).toString('hex') === '89504e47') return { mime: 'image/png', kind: 'image' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  if (buf.length > 5 && buf.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', kind: 'document' };
  return null;
}

class UpdateItemDto {
  @IsOptional() @IsString() @Length(2, 300) name?: string; @IsOptional() @IsString() description?: string; @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() brand?: string; @IsOptional() @IsString() mpn?: string; @IsOptional() @IsString() category?: string; @IsOptional() @IsObject() specs?: Record<string, string>;
  @IsOptional() @IsIn(['arc', 'qrc', 'on_quote', 'non_serviceable']) procmartServiceability?: string; @IsOptional() @IsIn(['draft', 'active', 'retired']) status?: string;
}
class EquivalentDto { @IsUUID() erpSystemId: string; @IsString() @Length(1, 60) materialCode: string; @IsUUID() itemId: string; @IsOptional() @IsString() note?: string }
class CategoryAttrDto { @IsString() category: string; @IsString() @Length(1, 40) key: string; @IsString() @Length(1, 60) label: string; @IsOptional() required?: boolean; @IsOptional() position?: number }

class ItemDto {
  @IsString() @Length(2, 300) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() mpn?: string;
  @IsString() uom: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsObject() specs?: Record<string, string>;
  @IsOptional() @IsIn(['arc', 'qrc', 'on_quote', 'non_serviceable']) procmartServiceability?: string;
  /** Customer material codes, each within an ERP/server context. */
  @IsOptional() erpCodes?: { erpSystemId: string; materialCode: string }[];
}

export async function insertItem(c: PoolClient, ctx: Ctx, b: ItemDto) {
  const r = await c.query(
    `INSERT INTO catalogue_items(tenant_id,name,description,manufacturer,brand,mpn,uom,category,specs,procmart_serviceability)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [ctx.tenantId, b.name, b.description ?? '', b.manufacturer ?? null, b.brand ?? null, b.mpn ?? null, b.uom.trim().toUpperCase(), b.category ?? null, JSON.stringify(b.specs ?? {}), b.procmartServiceability ?? null],
  );
  const id = r.rows[0].id;
  for (const k of b.erpCodes ?? []) {
    const ok = await c.query(`SELECT 1 FROM erp_systems WHERE id=$1`, [k.erpSystemId]);
    if (!ok.rowCount) throw new BadRequestException('Unknown ERP system for material code');
    await c.query(`INSERT INTO item_erp_codes(tenant_id,item_id,erp_system_id,material_code) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, id, k.erpSystemId, k.materialCode]);
  }
  await c.query(`INSERT INTO catalogue_item_versions(tenant_id,item_id,version,snapshot,changed_by) VALUES ($1,$2,1,$3,$4)`, [ctx.tenantId, id, JSON.stringify(b), ctx.userId]);
  await audit(c, ctx, 'catalogue_item.created', 'catalogue_item', id, { name: b.name });
  return id as string;
}

@Controller('catalogue')
export class CatalogueController {
  constructor(private db: Db, private storage: Storage) {}

  @Perm('catalogue:write')
  @Post('items')
  create(@CurrentCtx() ctx: Ctx, @Body() b: ItemDto) {
    return this.db.tx(ctx, async (c) => ({ id: await insertItem(c, ctx, b) }));
  }

  /** CSV columns: name, description, manufacturer, brand, mpn, uom, category, serviceability, server, material_code */
  @Perm('catalogue:write')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async import(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    let rows: any[];
    try { rows = parse(file.buffer, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, bom: true }); }
    catch { throw new BadRequestException('Not a valid CSV'); }
    return this.db.tx(ctx, async (c) => {
      const erps = new Map((await c.query(`SELECT code,id FROM erp_systems`)).rows.map((r) => [r.code, r.id]));
      let n = 0;
      const errors: string[] = [];
      for (const [i, r] of rows.entries()) {
        if (!r.name || !r.uom) { errors.push(`row ${i + 2}: name and uom required`); continue; }
        const erpCodes = r.material_code && erps.get(r.server) ? [{ erpSystemId: erps.get(r.server), materialCode: r.material_code }] : [];
        if (r.material_code && !erps.get(r.server)) { errors.push(`row ${i + 2}: unknown server "${r.server}"`); continue; }
        const specs = Object.fromEntries(Object.entries(r).filter(([k, v]) => k.startsWith('spec_') && v).map(([k, v]) => [k.slice(5), String(v)]));
        await insertItem(c, ctx, { specs, name: r.name, description: r.description, manufacturer: r.manufacturer, brand: r.brand, mpn: r.mpn, uom: r.uom, category: r.category, procmartServiceability: r.serviceability || undefined, erpCodes } as any);
        n++;
      }
      return { imported: n, errors };
    });
  }

  @Perm('catalogue:read')
  @Get('export')
  async export(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT id,name,description,manufacturer,brand,mpn,uom,category,procmart_serviceability,status FROM catalogue_items ORDER BY name`)).rows);
  }

  /** Search items; with plantId, each hit carries the contract coverage that applies to *that* plant only. */
  @Perm('catalogue:read')
  @Get('search')
  async search(@CurrentCtx() ctx: Ctx, @Query('q') q = '', @Query('plantId') plantId?: string) {
    if (plantId && !/^[0-9a-f-]{36}$/.test(plantId)) throw new BadRequestException('bad plantId');
    return this.db.tx(ctx, async (c) => {
      if (plantId && !(await canAtNode(c, ctx, 'catalogue:read', plantId))) throw new BadRequestException('Plant not in your scope');
      const term = q.trim();
      const ids = term ? (await searchCatalogue(c, term, { limit: 50 })).hits.map((h) => h.id) : [];
      const rows = term
        ? (await c.query(`SELECT i.*, (SELECT coalesce(json_agg(json_build_object('server', e.code, 'code', ic.material_code)), '[]') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes
               FROM catalogue_items i WHERE i.id = ANY($1::uuid[])`, [ids])).rows
        : (await c.query(`SELECT i.*, '[]'::json AS codes FROM catalogue_items i WHERE status='active' ORDER BY po_lines DESC, name LIMIT 50`)).rows;
      const items = term ? ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) : rows;
      return enrichItems(c, items, plantId);
    });
  }

  @Perm('catalogue:read')
  @Get('items/:id')
  async one(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`SELECT id,name,description,manufacturer,brand,mpn,uom,category,specs,procmart_serviceability,status,version FROM catalogue_items WHERE id=$1`, [id]);
      if (!r.rowCount) throw new NotFoundException();
      return r.rows[0];
    });
  }

  // ───────── item detail, edits, versions ─────────
  @Perm('catalogue:read')
  @Get('items/:id/detail')
  async detail(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('plantId') plantId?: string) {
    if (!/^[0-9a-f-]{36}$/.test(id) || (plantId && !/^[0-9a-f-]{36}$/.test(plantId))) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      if (plantId && !(await canAtNode(c, ctx, 'catalogue:read', plantId))) throw new BadRequestException('Plant not in your scope');
      const it = (await c.query(`SELECT i.*, (SELECT coalesce(json_agg(json_build_object('server', e.code, 'code', ic.material_code)), '[]') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes FROM catalogue_items i WHERE i.id=$1`, [id])).rows[0];
      if (!it) throw new NotFoundException();
      const [enriched] = await enrichItems(c, [it], plantId);
      const assets = (await c.query(`SELECT id, kind, filename, mime, size_bytes AS "sizeBytes", caption FROM item_assets WHERE item_id=$1 ORDER BY created_at`, [id])).rows;
      const attrs = it.category ? (await c.query(`SELECT key, label, required FROM category_attributes WHERE category=$1 ORDER BY position, label`, [it.category])).rows : [];
      return { ...enriched, assets, attributes: attrs };
    });
  }

  @Perm('catalogue:write')
  @Post('items/:id/update')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: UpdateItemDto) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const cur = (await c.query(`SELECT * FROM catalogue_items WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw new NotFoundException();
      const next = { name: b.name ?? cur.name, description: b.description ?? cur.description, manufacturer: b.manufacturer ?? cur.manufacturer, brand: b.brand ?? cur.brand, mpn: b.mpn ?? cur.mpn,
        category: b.category ?? cur.category, specs: b.specs ?? cur.specs, serviceability: b.procmartServiceability ?? cur.procmart_serviceability, status: b.status ?? cur.status };
      await c.query(`UPDATE catalogue_items SET name=$2, description=$3, manufacturer=$4, brand=$5, mpn=$6, category=$7, specs=$8, procmart_serviceability=$9, status=$10, version=version+1 WHERE id=$1`,
        [id, next.name, next.description, next.manufacturer, next.brand, next.mpn, next.category, JSON.stringify(next.specs), next.serviceability, next.status]);
      const v = cur.version + 1;
      await c.query(`INSERT INTO catalogue_item_versions(tenant_id,item_id,version,snapshot,changed_by) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, id, v, JSON.stringify(next), ctx.userId]);
      await audit(c, ctx, 'catalogue_item.updated', 'catalogue_item', id, { version: v, fields: Object.keys(b) });
      return { version: v };
    });
  }

  @Perm('catalogue:read')
  @Get('items/:id/versions')
  async versions(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT v.version, v.snapshot, v.at, u.name AS "changedBy" FROM catalogue_item_versions v LEFT JOIN users u ON u.id=v.changed_by WHERE v.item_id=$1 ORDER BY v.version DESC`, [id])).rows);
  }

  // ───────── images & documents ─────────
  @Perm('catalogue:write')
  @Post('items/:id/assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async addAsset(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() b: { caption?: string }) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    if (!file) throw new BadRequestException('file required');
    const kind = sniffAsset(file.buffer);
    if (!kind) throw new BadRequestException('Only PNG, JPEG, WebP images and PDF documents are accepted');
    const stored = await this.storage.put(ctx.tenantId, file.buffer);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1`, [id])).rowCount) throw new NotFoundException();
      const r = (await c.query(`INSERT INTO item_assets(tenant_id,item_id,kind,filename,mime,size_bytes,sha256,storage_key,caption,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ctx.tenantId, id, kind.kind, file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120), kind.mime, file.size, stored.sha256, stored.key, (b.caption ?? '').slice(0, 200) || null, ctx.userId])).rows[0];
      await audit(c, ctx, 'catalogue_asset.added', 'catalogue_item', id, { assetId: r.id, kind: kind.kind });
      return { id: r.id, kind: kind.kind };
    });
  }

  @Perm('catalogue:read')
  @Get('assets/:id')
  async asset(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    const a = await this.db.tx(ctx, async (c) => (await c.query(`SELECT filename, mime, kind, storage_key FROM item_assets WHERE id=$1`, [id])).rows[0]);
    if (!a) throw new NotFoundException();
    res.setHeader('Content-Type', a.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `${a.kind === 'image' ? 'inline' : 'attachment'}; filename="${a.filename}"`);
    res.send(await this.storage.get(a.storage_key));
  }

  // ───────── equivalence list (match ladder step 3) & guided-buying attributes ─────────
  @Perm('catalogue:write')
  @Post('equivalents')
  async addEquivalent(@CurrentCtx() ctx: Ctx, @Body() b: EquivalentDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1`, [b.itemId])).rowCount) throw new BadRequestException('Unknown item');
      if (!(await c.query(`SELECT 1 FROM erp_systems WHERE id=$1`, [b.erpSystemId])).rowCount) throw new BadRequestException('Unknown ERP system');
      if ((await c.query(`SELECT 1 FROM item_erp_codes WHERE erp_system_id=$1 AND material_code=$2`, [b.erpSystemId, b.materialCode])).rowCount) throw new ConflictException('That code already belongs to a catalogue item; it is not an equivalent');
      try { await c.query(`INSERT INTO material_equivalents(tenant_id,erp_system_id,material_code,item_id,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, b.erpSystemId, b.materialCode, b.itemId, b.note ?? null, ctx.userId]); }
      catch (e: any) { if (e.code === '23505') throw new ConflictException('Equivalent already recorded'); throw e; }
      await audit(c, ctx, 'equivalent.added', 'catalogue_item', b.itemId, b);
      return { ok: true };
    });
  }
  @Perm('catalogue:read')
  @Get('equivalents')
  listEquivalents(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT q.id, e.code AS server, q.material_code AS "materialCode", i.name AS item, q.note FROM material_equivalents q JOIN erp_systems e ON e.id=q.erp_system_id JOIN catalogue_items i ON i.id=q.item_id ORDER BY i.name`)).rows);
  }
  @Perm('catalogue:write')
  @Post('category-attributes')
  async setAttr(@CurrentCtx() ctx: Ctx, @Body() b: CategoryAttrDto) {
    return this.db.tx(ctx, async (c) => {
      await c.query(`INSERT INTO category_attributes(tenant_id,category,key,label,required,position) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,category,key) DO UPDATE SET label=EXCLUDED.label, required=EXCLUDED.required, position=EXCLUDED.position`, [ctx.tenantId, b.category, b.key, b.label, b.required === true, b.position ?? 0]);
      await audit(c, ctx, 'category_attribute.set', 'category', b.category, b);
      return { ok: true };
    });
  }
  @Perm('catalogue:read')
  @Get('category-attributes')
  listAttrs(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT category, key, label, required, position FROM category_attributes ORDER BY category, position, label`)).rows);
  }
}
