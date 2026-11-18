import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Matches } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, hasPerm, Perm, visibleNodeIds } from '../common/security';
import { computeSources } from './source';

const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);
const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

class CoverageReqDto { @IsUUID() itemId: string; @IsUUID() plantId: string; @IsOptional() @IsUUID() contractId?: string; @IsOptional() @IsString() @Length(0, 500) note?: string }
class ResolveDto { @IsString() @Length(2, 500) resolution: string; @IsOptional() extend?: boolean }
class ScopeDto { @IsUUID() nodeId: string }
class NonCatalogueDto {
  @IsUUID() plantId: string; @IsString() @Length(3, 200) name: string; @IsOptional() @IsString() @Length(0, 100) brand?: string; @IsOptional() @IsString() @Length(0, 100) mpn?: string;
  @IsOptional() @IsString() @Length(0, 1000) spec?: string; @IsOptional() @IsString() @Length(0, 500) reason?: string; @IsNumber() @IsPositive() qty: number; @IsString() @Length(1, 12) uom: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) needBy?: string;
}
class AliasDto { @IsIn(['sap_description', 'supplier_code', 'common_name', 'application']) kind: string; @IsString() @Length(2, 200) value: string; @IsOptional() @IsUUID() supplierId?: string }
class AltDto { @IsUUID() itemId: string; @IsUUID() alternativeItemId: string; @IsOptional() @IsString() note?: string }

@Controller()
export class SourceController {
  constructor(private db: Db) {}

  // ───────── Case B: "your group has a contract, not confirmed for my plant" → ask procurement ─────────
  @Perm('buying:request')
  @Post('coverage-requests')
  create(@CurrentCtx() ctx: Ctx, @Body() b: CoverageReqDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await canAtNode(c, ctx, 'buying:request', b.plantId))) throw new BadRequestException('Plant not in your scope');
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1`, [b.itemId])).rowCount) throw new NotFoundException();
      try {
        const r = (await c.query(`INSERT INTO coverage_requests(tenant_id,item_id,plant_node_id,contract_id,requested_by,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [ctx.tenantId, b.itemId, b.plantId, b.contractId ?? null, ctx.userId, b.note ?? null])).rows[0];
        await audit(c, ctx, 'coverage_request.created', 'coverage_request', r.id, b); return { id: r.id, status: 'open' };
      } catch (e: any) { if (e.code === '23505') throw new ConflictException('A request for this item and plant is already open'); throw e; }
    });
  }

  @Perm('buying:request')
  @Get('coverage-requests')
  list(@CurrentCtx() ctx: Ctx, @Query('status') status = 'open') {
    return this.db.tx(ctx, async (c) => {
      const all = hasPerm(ctx, 'contracts:write'); const vis = await visibleNodeIds(c, ctx, 'buying:read');
      return (await c.query(
        `SELECT q.id, q.status, q.note, q.resolution, q.created_at AS "createdAt", i.id AS "itemId", i.name AS item, n.id AS "plantId", n.name AS plant, u.name AS "requestedBy", ct.id AS "contractId", ct.number AS contract, s.legal_name AS supplier,
                (SELECT coalesce(json_agg(DISTINCT ct2.number), '[]') FROM contract_lines cl JOIN contracts ct2 ON ct2.id=cl.contract_id WHERE cl.item_id=q.item_id AND cl.status='published' AND ct2.status='published') AS "contractsForItem"
           FROM coverage_requests q JOIN catalogue_items i ON i.id=q.item_id JOIN org_nodes n ON n.id=q.plant_node_id JOIN users u ON u.id=q.requested_by LEFT JOIN contracts ct ON ct.id=q.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id
          WHERE q.status=$1 AND ($2 OR q.requested_by=$3 OR q.plant_node_id = ANY($4::uuid[])) ORDER BY q.created_at DESC LIMIT 200`, [status === 'resolved' ? 'resolved' : 'open', all, ctx.userId, vis ?? []])).rows;
    });
  }

  /** Procurement closes a request; "extend" also adds the plant to the contract's applicability (one click, audited). */
  @Perm('contracts:write')
  @Post('coverage-requests/:id/resolve')
  resolve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: ResolveDto) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const q = (await c.query(`SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!q) throw new NotFoundException(); if (q.status !== 'open') throw new ConflictException('Already resolved');
      if (b.extend) {
        if (!hasPerm(ctx, 'contracts:approve')) throw new BadRequestException('Extending a contract needs contract approval authority');
        if (!q.contract_id) throw new BadRequestException('This request names no contract to extend');
        await c.query(`INSERT INTO contract_scopes(tenant_id,contract_id,node_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.tenantId, q.contract_id, q.plant_node_id]);
        await audit(c, ctx, 'contract.scope_extended', 'contract', q.contract_id, { plant: q.plant_node_id, via: 'coverage_request', request: id });
      }
      await c.query(`UPDATE coverage_requests SET status='resolved', resolution=$2, resolved_by=$3, resolved_at=now() WHERE id=$1`, [id, b.resolution, ctx.userId]);
      await audit(c, ctx, 'coverage_request.resolved', 'coverage_request', id, b); return { ok: true, extended: !!b.extend };
    });
  }

  @Perm('contracts:approve')
  @Post('contracts/:id/scopes')
  addScope(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: ScopeDto) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const ct = (await c.query(`SELECT status FROM contracts WHERE id=$1`, [id])).rows[0]; if (!ct) throw new NotFoundException();
      if (['rejected', 'expired'].includes(ct.status)) throw new ConflictException(`Contract is ${ct.status}`);
      if (!(await c.query(`SELECT 1 FROM org_nodes WHERE id=$1`, [b.nodeId])).rowCount) throw new BadRequestException('Unknown node');
      await c.query(`INSERT INTO contract_scopes(tenant_id,contract_id,node_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.tenantId, id, b.nodeId]);
      await audit(c, ctx, 'contract.scope_extended', 'contract', id, { node: b.nodeId }); return { ok: true };
    });
  }

  // ───────── Case E / D: non-catalogue requirement or sourcing request ─────────
  @Perm('buying:request')
  @Post('cart/non-catalogue')
  nonCatalogue(@CurrentCtx() ctx: Ctx, @Body() b: NonCatalogueDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM org_nodes WHERE id=$1 AND level_type='plant'`, [b.plantId])).rowCount) throw new BadRequestException('Not a plant');
      if (!(await canAtNode(c, ctx, 'buying:request', b.plantId))) throw new BadRequestException('You cannot raise requirements for this plant');
      const desc = [b.spec, b.reason && `Reason: ${b.reason}`].filter(Boolean).join('\n');
      const item = (await c.query(`INSERT INTO catalogue_items(tenant_id,name,description,brand,mpn,uom,status,source,requested_by) VALUES ($1,$2,$3,$4,$5,$6,'draft','requested',$7) RETURNING id`,
        [ctx.tenantId, b.name, desc, b.brand ?? null, b.mpn ?? null, b.uom.trim().toUpperCase(), ctx.userId])).rows[0];
      let cart = (await c.query(`SELECT id FROM carts WHERE user_id=$1 AND plant_node_id=$2 AND status='open'`, [ctx.userId, b.plantId])).rows[0];
      if (!cart) cart = (await c.query(`INSERT INTO carts(tenant_id,user_id,plant_node_id) VALUES ($1,$2,$3) RETURNING id`, [ctx.tenantId, ctx.userId, b.plantId])).rows[0];
      await c.query(`INSERT INTO cart_lines(tenant_id,cart_id,item_id,qty,uom,need_by,intent,note) VALUES ($1,$2,$3,$4,$5,$6,'source',$7)`, [ctx.tenantId, cart.id, item.id, b.qty, b.uom.trim().toUpperCase(), b.needBy ?? null, 'Non-catalogue request']);
      await audit(c, ctx, 'non_catalogue.requested', 'catalogue_item', item.id, { name: b.name }); return { cartId: cart.id, itemId: item.id };
    });
  }

  // ───────── how people describe items: aliases; approved alternatives ─────────
  @Perm('catalogue:write')
  @Post('catalogue/items/:id/aliases')
  alias(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: AliasDto) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1`, [id])).rowCount) throw new NotFoundException();
      await c.query(`INSERT INTO item_aliases(tenant_id,item_id,kind,value,supplier_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ctx.tenantId, id, b.kind, b.value.trim(), b.supplierId ?? null]);
      await audit(c, ctx, 'alias.added', 'catalogue_item', id, b); return { ok: true };
    });
  }
  @Perm('catalogue:write')
  @Post('catalogue/alternatives')
  alt(@CurrentCtx() ctx: Ctx, @Body() b: AltDto) {
    return this.db.tx(ctx, async (c) => {
      for (const i of [b.itemId, b.alternativeItemId]) if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1 AND status='active'`, [i])).rowCount) throw new BadRequestException('Unknown or inactive item');
      try { await c.query(`INSERT INTO item_alternatives(tenant_id,item_id,alternative_item_id,note,approved_by) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, b.itemId, b.alternativeItemId, b.note ?? null, ctx.userId]); }
      catch (e: any) { if (e.code === '23505') throw new ConflictException('Already recorded'); if (e.code === '23514') throw new BadRequestException('An item cannot be its own alternative'); throw e; }
      await audit(c, ctx, 'alternative.approved', 'catalogue_item', b.itemId, b); return { ok: true };
    });
  }

  // ───────── PO history (stand-in for a SAP PO feed) and off-contract analysis ─────────
  /** CSV: po_number, po_date, server, plant_code, material_code, vendor_code, vendor_name, qty, uom, unit_price */
  @Perm('contracts:write')
  @Post('po-history/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async importPo(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    let rows: any[]; try { rows = parse(file.buffer, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, bom: true }); } catch { throw new BadRequestException('Not a valid CSV'); }
    return this.db.tx(ctx, async (c) => {
      let n = 0; const errors: string[] = [];
      for (const [i, r] of rows.entries()) {
        const plant = (await c.query(`SELECT n.id FROM org_nodes n JOIN erp_systems e ON e.id=n.erp_system_id WHERE n.level_type='plant' AND n.code=$1 AND e.code=$2`, [r.plant_code, r.server])).rows[0];
        if (!plant) { errors.push(`row ${i + 2}: unknown plant ${r.plant_code}@${r.server}`); continue; }
        if (!isDate(r.po_date) || !(Number(r.qty) > 0) || !(Number(r.unit_price) > 0)) { errors.push(`row ${i + 2}: bad date, qty or price`); continue; }
        const item = (await c.query(`SELECT ic.item_id FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.material_code=$1 AND e.code=$2`, [r.material_code, r.server])).rows[0];
        const sup = r.vendor_code ? (await c.query(`SELECT sc.supplier_id FROM supplier_erp_codes sc JOIN erp_systems e ON e.id=sc.erp_system_id WHERE sc.vendor_code=$1 AND e.code=$2`, [r.vendor_code, r.server])).rows[0] : null;
        await c.query(`INSERT INTO po_history(tenant_id,po_number,po_date,plant_node_id,item_id,material_code,vendor_code,vendor_name,supplier_id,qty,uom,unit_price,imported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [ctx.tenantId, r.po_number, r.po_date, plant.id, item?.item_id ?? null, r.material_code ?? null, r.vendor_code ?? null, r.vendor_name ?? null, sup?.supplier_id ?? null, r.qty, r.uom ?? null, r.unit_price, ctx.userId]); n++;
      }
      await audit(c, ctx, 'po_history.imported', 'po_history', undefined, { rows: n }); return { imported: n, errors };
    });
  }

  /**
   * Off-contract analysis against PO history. For each PO line it asks: on that date, did a valid ARC/QRC for the item
   * cover that plant? Was the buy from the contract supplier, at the contract price?
   *   on_contract · price_leakage (right supplier, higher price) · leakage (contract existed, bought elsewhere)
   *   coverage_gap (a contract existed in the group but not for that plant) · no_contract
   */
  @Perm('analytics:read')
  @Get('coverage/analysis')
  analysis(@CurrentCtx() ctx: Ctx, @Query('from') from?: string, @Query('to') to?: string) {
    if (!isDate(from) || !isDate(to)) throw new BadRequestException('Dates must be YYYY-MM-DD');
    const f = from ?? new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10), t = to ?? new Date().toISOString().slice(0, 10);
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'analytics:read');
      const lines = (await c.query(
        `WITH RECURSIVE anc(plant_id, node_id) AS (SELECT id, id FROM org_nodes WHERE level_type='plant' UNION ALL SELECT anc.plant_id, n.parent_id FROM anc JOIN org_nodes n ON n.id=anc.node_id WHERE n.parent_id IS NOT NULL),
         h AS (SELECT ph.*, n.name AS plant_name, i.name AS item_name, i.category FROM po_history ph JOIN org_nodes n ON n.id=ph.plant_node_id LEFT JOIN catalogue_items i ON i.id=ph.item_id
                WHERE ph.po_date >= $1::date AND ph.po_date <= $2::date AND ($3::uuid[] IS NULL OR ph.plant_node_id = ANY($3)))
         SELECT h.id, h.po_number, h.po_date, h.plant_node_id AS "plantId", h.plant_name AS plant, h.item_id AS "itemId", h.item_name AS item, h.category, h.vendor_name AS vendor, h.supplier_id AS "supplierId", h.qty::float AS qty, h.unit_price::float AS price,
           coalesce((SELECT json_agg(json_build_object('contractId', ct.id, 'number', ct.number, 'supplierId', ct.supplier_id, 'supplier', s.legal_name, 'price', cl.net_price::float,
                      'atPlant', EXISTS (SELECT 1 FROM contract_scopes cs JOIN anc ON anc.node_id=cs.node_id WHERE cs.contract_id=ct.id AND anc.plant_id=h.plant_node_id)))
                      FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id
                      WHERE cl.item_id=h.item_id AND cl.status='published' AND ct.status='published' AND ct.contract_type IN ('ARC','QRC') AND ct.valid_from <= h.po_date AND ct.valid_to >= h.po_date), '[]') AS contracts
         FROM h ORDER BY h.po_date DESC`, [f, t, vis])).rows;
      const classify = (l: any) => {
        if (!l.itemId) return { cls: 'unmapped' as const };
        const here = (l.contracts as any[]).filter((x) => x.atPlant), elsewhere = (l.contracts as any[]).filter((x) => !x.atPlant);
        if (here.length) { const m = here.find((x) => x.supplierId && x.supplierId === l.supplierId); if (!m) { const best = here.reduce((a, b) => (a.price <= b.price ? a : b)); return { cls: 'leakage' as const, contract: best, avoidable: Math.max(0, (l.price - best.price) * l.qty) }; }
          return l.price > m.price + 0.005 ? { cls: 'price_leakage' as const, contract: m, avoidable: (l.price - m.price) * l.qty } : { cls: 'on_contract' as const, contract: m, avoidable: 0 }; }
        if (elsewhere.length) { const best = elsewhere.reduce((a, b) => (a.price <= b.price ? a : b)); return { cls: 'coverage_gap' as const, contract: best, avoidable: Math.max(0, (l.price - best.price) * l.qty) }; }
        return { cls: 'no_contract' as const };
      };
      const rows = lines.map((l) => ({ ...l, ...classify(l), value: l.qty * l.price }));
      const sum = (cls: string) => { const r = rows.filter((x) => x.cls === cls); return { lines: r.length, value: r.reduce((s, x) => s + x.value, 0), avoidable: r.reduce((s, x) => s + (x.avoidable ?? 0), 0) }; };
      const classes = ['on_contract', 'price_leakage', 'leakage', 'coverage_gap', 'no_contract'].map((k) => ({ cls: k, ...sum(k) }));
      const mapped = rows.filter((x) => x.cls !== 'unmapped'); const totalValue = mapped.reduce((s, x) => s + x.value, 0);
      const group = <K extends string>(keyOf: (r: any) => string, pick: string[]) => { const m = new Map<string, any>(); for (const r of rows.filter((x) => pick.includes(x.cls))) { const k = keyOf(r); const g = m.get(k) ?? { key: k, lines: 0, value: 0, avoidable: 0 }; g.lines++; g.value += r.value; g.avoidable += r.avoidable ?? 0; m.set(k, g); } return [...m.values()].sort((a, b) => b.avoidable - a.avoidable || b.value - a.value); };
      const opportunities = (() => { const m = new Map<string, any>(); for (const r of rows.filter((x) => ['coverage_gap', 'leakage', 'price_leakage'].includes(x.cls))) { const k = `${r.itemId}|${r.plantId}|${r.cls}`; const g = m.get(k) ?? { itemId: r.itemId, item: r.item, plantId: r.plantId, plant: r.plant, cls: r.cls, contractId: r.contract?.contractId, contract: r.contract?.number, supplier: r.contract?.supplier, lines: 0, value: 0, avoidable: 0, vendors: new Set<string>() }; g.lines++; g.value += r.value; g.avoidable += r.avoidable ?? 0; if (r.vendor) g.vendors.add(r.vendor); m.set(k, g); } return [...m.values()].map((g) => ({ ...g, vendors: [...g.vendors] })).sort((a, b) => b.avoidable - a.avoidable || b.value - a.value).slice(0, 25); })();
      return { from: f, to: t, source: 'PO history import (illustrative stand-in for a SAP PO feed)', totalLines: mapped.length, totalValue, unmapped: rows.length - mapped.length, classes, byPlant: group((r) => r.plant, ['coverage_gap', 'leakage', 'price_leakage']), byCategory: group((r) => r.category ?? 'Uncategorised', ['coverage_gap', 'leakage', 'price_leakage']), opportunities, rows: rows.slice(0, 200).map(({ contracts, ...r }) => r) };
    });
  }

  @Perm('buying:request')
  @Get('work/summary')
  async summary(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read'); const all = vis === null;
      const exceptions = (await c.query(`SELECT count(*)::int AS n FROM exceptions e JOIN requirements r ON r.id=e.requirement_id WHERE e.status='open' AND ($1 OR r.plant_node_id = ANY($2::uuid[]))`, [all, vis ?? []])).rows[0].n;
      const requests = hasPerm(ctx, 'contracts:write') ? (await c.query(`SELECT count(*)::int AS n FROM coverage_requests WHERE status='open'`)).rows[0].n : 0;
      const agenticTasks = (await c.query(`SELECT count(*)::int AS n FROM human_tasks t JOIN requirements r ON r.id=t.requirement_id WHERE t.status='open' AND ($1 OR r.plant_node_id = ANY($2::uuid[]))`, [all, vis ?? []])).rows[0].n;
      return { exceptions, coverageRequests: requests, agenticTasks, total: exceptions + requests };
    });
  }
}
