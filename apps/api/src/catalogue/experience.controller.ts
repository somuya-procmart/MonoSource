import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsNumber, IsOptional, IsPositive, Matches } from 'class-validator';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, hasPerm, Perm, visibleNodeIds } from '../common/security';
import { compactSource, enrichItems } from './catalogue.controller';
import { computeSources, suggestSimilar } from './source';
import { applicableLines } from '../contracts/coverage';
import { routeLines } from '../buying/buying.controller';
import { lineQuantities } from '../buying/orders.controller';

const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);
const csv = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const lowest = (it: any): number | null => { if (it.source) return it.source.lowestPrice; const p = (it.contractCoverage ?? []).map((c: any) => Number(c.netPrice)).filter((n: number) => Number.isFinite(n)); return p.length ? Math.min(...p) : null; };

class QtyDto { @IsOptional() @IsNumber() @IsPositive() qty?: number; @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) needBy?: string }

@Controller()
export class ExperienceController {
  constructor(private db: Db) {}

  // ───────── discover: search + filters + facets + sort ─────────
  @Perm('catalogue:read')
  @Get('discover')
  async discover(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    if (q.plantId && !isId(q.plantId)) throw new BadRequestException('bad plantId');
    const ids = csv(q.ids).slice(0, 200); if (ids.some((x) => !isId(x))) throw new BadRequestException('bad ids');
    return this.db.tx(ctx, async (c) => {
      if (q.plantId && !(await canAtNode(c, ctx, 'catalogue:read', q.plantId))) throw new BadRequestException('Plant not in your scope');
      const term = (q.q ?? '').trim();
      const likes = term.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter(Boolean).map((w) => `%${w}%`); if (!likes.length) likes.push('%');
      const tsq = term.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).map((w) => w + ':*').join(' & ');
      const rows = ids.length
        ? (await c.query(`SELECT i.* FROM catalogue_items i WHERE i.status='active' AND i.id = ANY($1::uuid[])`, [ids])).rows
        : term
          ? (await c.query(
              `SELECT i.*, GREATEST(ts_rank(search, to_tsquery('simple', $2)), similarity(name,$1)) AS rank FROM catalogue_items i
                WHERE i.status='active' AND (search @@ to_tsquery('simple', $2) OR name % $1 OR lower(i.category) = lower($1) OR lower(i.brand) = lower($1)
                      OR EXISTS (SELECT 1 FROM item_erp_codes ic WHERE ic.item_id=i.id AND ic.material_code = $1)
                      OR EXISTS (SELECT 1 FROM jsonb_each_text(i.specs) e WHERE lower(e.value) = lower($1))
                      OR EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id=i.id AND lower(a.value) LIKE ALL($3::text[]))
                      OR EXISTS (SELECT 1 FROM contract_lines cl WHERE cl.item_id=i.id AND cl.status='published' AND (lower(cl.description) LIKE ALL($3::text[]) OR lower(cl.supplier_item_code) = lower($1))))
                ORDER BY rank DESC, name LIMIT 300`, [term, tsq || 'x', likes])).rows
          : (await c.query(`SELECT i.* FROM catalogue_items i WHERE i.status='active' ORDER BY name LIMIT 300`)).rows;
      const codes = rows.length ? (await c.query(`SELECT ic.item_id, e.code AS server, ic.material_code AS code FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id = ANY($1::uuid[])`, [rows.map((r) => r.id)])).rows : [];
      const saved = new Set((await c.query(`SELECT item_id FROM saved_items WHERE user_id=$1`, [ctx.userId])).rows.map((r) => r.item_id));
      const matched = new Map<string, { kind: string; value: string; supplier?: string }>();
      if (term && !ids.length && rows.length) {
        const rid = rows.map((r) => r.id); const tl = term.toLowerCase().split(/\s+/).filter(Boolean);
        const direct = (r: any) => { const hay = `${r.name} ${r.brand ?? ''} ${r.mpn ?? ''} ${r.category ?? ''} ${codes.filter((x) => x.item_id === r.id).map((x) => x.code).join(' ')} ${Object.values(r.specs ?? {}).join(' ')}`.toLowerCase(); return tl.every((t) => hay.includes(t)); };
        const aliasRows = (await c.query(`SELECT a.item_id, a.kind, a.value FROM item_aliases a WHERE a.item_id = ANY($1::uuid[]) AND lower(a.value) LIKE ALL($2::text[])`, [rid, likes])).rows;
        const clRows = (await c.query(`SELECT cl.item_id, cl.description, cl.supplier_item_code, s.legal_name FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id WHERE cl.item_id = ANY($1::uuid[]) AND cl.status='published' AND (lower(cl.description) LIKE ALL($2::text[]) OR lower(cl.supplier_item_code) = lower($3))`, [rid, likes, term])).rows;
        for (const r of rows) { if (direct(r)) continue; const a = aliasRows.find((x) => x.item_id === r.id); const k = clRows.find((x) => x.item_id === r.id);
          if (a) matched.set(r.id, { kind: a.kind, value: a.value }); else if (k) matched.set(r.id, k.supplier_item_code && k.supplier_item_code.toLowerCase() === term.toLowerCase() ? { kind: 'supplier_code', value: k.supplier_item_code, supplier: k.legal_name } : { kind: 'contract_description', value: k.description, supplier: k.legal_name }); }
      }
      const all = (await enrichItems(c, rows.map((r) => ({ ...r })), q.plantId || null)).map((i: any) => ({ ...i, codes: codes.filter((x) => x.item_id === i.id).map((x) => ({ server: x.server, code: x.code })), saved: saved.has(i.id), lowestPrice: lowest(i), matchedOn: matched.get(i.id) ?? null }));

      const count = (get: (i: any) => string[]) => { const m = new Map<string, number>(); for (const i of all) for (const v of new Set(get(i).filter(Boolean))) m.set(v, (m.get(v) ?? 0) + 1); return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)); };
      const facets = { categories: count((i) => [i.category]), brands: count((i) => [i.brand]), suppliers: count((i) => (i.contractCoverage ?? []).map((x: any) => x.supplier)), uoms: count((i) => [i.uom]),
        coverage: { onContract: all.filter((i) => i.source?.case === 'A').length, noContract: all.filter((i) => i.source?.case !== 'A').length },
        cases: ['A', 'B', 'D', 'E'].map((k) => ({ value: k, count: all.filter((i) => i.source?.case === k).length })) };

      const cats = csv(q.category), brands = csv(q.brand), sups = csv(q.supplier), uoms = csv(q.uom);
      let out = all.filter((i) => (!cats.length || cats.includes(i.category)) && (!brands.length || brands.includes(i.brand)) && (!uoms.length || uoms.includes(i.uom))
        && (!sups.length || (i.contractCoverage ?? []).some((x: any) => sups.includes(x.supplier)))
        && (q.coverage === 'on' ? i.source?.case === 'A' : q.coverage === 'none' ? i.source?.case !== 'A' : true) && (!q.case || csv(q.case).includes(i.source?.case)));
      if (q.sort === 'price_asc') out = [...out].sort((a, b) => (a.lowestPrice ?? 1e18) - (b.lowestPrice ?? 1e18));
      else if (q.sort === 'price_desc') out = [...out].sort((a, b) => (b.lowestPrice ?? -1) - (a.lowestPrice ?? -1));
      else if (q.sort === 'name') out = [...out].sort((a, b) => a.name.localeCompare(b.name));
      return { total: out.length, items: out.slice(0, 80), facets };
    });
  }

  // ───────── product page: item + every valid contract supply (never silently picks one) ─────────
  @Perm('catalogue:read')
  @Get('products/:id')
  async product(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('plantId') plantId?: string) {
    if (!isId(id) || (plantId && !isId(plantId))) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      if (plantId && !(await canAtNode(c, ctx, 'catalogue:read', plantId))) throw new BadRequestException('Plant not in your scope');
      const it = (await c.query(`SELECT * FROM catalogue_items WHERE id=$1`, [id])).rows[0];
      if (!it) throw new NotFoundException();
      const plant = plantId ? (await c.query(`SELECT n.id, n.name, n.code, n.erp_system_id, e.code AS server FROM org_nodes n LEFT JOIN erp_systems e ON e.id=n.erp_system_id WHERE n.id=$1`, [plantId])).rows[0] : null;
      const rows = (await c.query(
        `SELECT cl.id AS "contractLineId", ct.id AS "contractId", ct.contract_type AS type, ct.number, ct.valid_from AS "validFrom", ct.valid_to AS "validTo", ct.supplier_id AS "supplierId", s.legal_name AS supplier,
                cl.net_price::float AS "netPrice", cl.uom, cl.moq::float AS moq, cl.qty_cap::float AS "qtyCap",
                coalesce((SELECT sum(rl.qty) FROM requirement_lines rl WHERE rl.contract_line_id=cl.id),0)::float AS used,
                coalesce((SELECT json_agg(n.name ORDER BY n.name) FROM contract_scopes cs JOIN org_nodes n ON n.id=cs.node_id WHERE cs.contract_id=ct.id),'[]') AS "appliesTo"
           FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id
          WHERE cl.item_id=$1 AND cl.status='published' AND ct.status='published' AND ct.contract_type IN ('ARC','QRC')
            AND (ct.valid_from IS NULL OR ct.valid_from <= current_date) AND (ct.valid_to IS NULL OR ct.valid_to >= current_date)`, [id])).rows;
      const applicable = plantId ? new Set((await applicableLines(c, plantId, [id], today())).map((l) => l.contract_line_id)) : null;
      const vendorOk = plant?.erp_system_id ? new Set((await c.query(`SELECT supplier_id FROM supplier_erp_codes WHERE erp_system_id=$1`, [plant.erp_system_id])).rows.map((r) => r.supplier_id)) : null;
      const supplies = rows.map((r) => ({
        ...r, daysLeft: r.validTo ? Math.round((new Date(r.validTo).getTime() - Date.now()) / 864e5) : null,
        balance: r.qtyCap === null ? null : Math.max(0, r.qtyCap - r.used),
        appliesToPlant: applicable ? applicable.has(r.contractLineId) : null,
        orderable: applicable ? applicable.has(r.contractLineId) && (vendorOk ? vendorOk.has(r.supplierId) : true) : null,
        blockedReason: applicable && !applicable.has(r.contractLineId) ? 'This contract does not cover your plant' : applicable && vendorOk && !vendorOk.has(r.supplierId) ? 'Supplier has no vendor code on your plant’s ERP yet' : null,
      })).sort((a, b) => Number(b.orderable === true) - Number(a.orderable === true) || (a.netPrice - b.netPrice));
      const [routingItem] = await enrichItems(c, [{ ...it }], plantId || null);
      const codes = (await c.query(`SELECT e.code AS server, ic.material_code AS code FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=$1`, [id])).rows;
      const equivalents = (await c.query(`SELECT e.code AS server, q.material_code AS code, q.note FROM material_equivalents q JOIN erp_systems e ON e.id=q.erp_system_id WHERE q.item_id=$1`, [id])).rows;
      const assets = (await c.query(`SELECT id, kind, filename, mime, size_bytes AS "sizeBytes", caption FROM item_assets WHERE item_id=$1 ORDER BY created_at`, [id])).rows;
      const attributes = it.category ? (await c.query(`SELECT key, label, required FROM category_attributes WHERE category=$1 ORDER BY position, label`, [it.category])).rows : [];
      const relatedRows = it.category ? (await c.query(`SELECT * FROM catalogue_items WHERE status='active' AND category=$1 AND id<>$2 ORDER BY name LIMIT 6`, [it.category, id])).rows : [];
      const related = await enrichItems(c, relatedRows, plantId || null);
      const saved = !!(await c.query(`SELECT 1 FROM saved_items WHERE user_id=$1 AND item_id=$2`, [ctx.userId, id])).rowCount;
      const nextStep = supplies.some((s) => s.orderable) ? null : routingItem.routing?.route === 'sourcing' ? 'No current contract covers this item for your plant. ProcMart can collect quotes for your approval.'
        : routingItem.routing?.route === 'direct' ? 'No contract covers this item. It can be supplied by ProcMart at the agreed price.' : plantId ? 'No current contract covers this item for your plant and it is not in a sourcing scope. Use your usual purchasing process.' : 'Select your plant to see which contracts apply.';
      const sv = (await computeSources(c, [id], plantId || null)).get(id)!;
      const apprRows = (await c.query(`SELECT item_id, alternative_item_id, note FROM item_alternatives WHERE item_id=$1 OR alternative_item_id=$1`, [id])).rows;
      const pool = it.category ? (await c.query(`SELECT id, category, specs FROM catalogue_items WHERE status='active' AND category=$1`, [it.category])).rows : [];
      const suggested = suggestSimilar({ id, category: it.category, specs: it.specs }, pool, apprRows);
      const altIds = [...apprRows.map((a) => (a.item_id === id ? a.alternative_item_id : a.item_id)), ...suggested.map((x) => x.id)];
      const altItems = altIds.length ? await enrichItems(c, (await c.query(`SELECT * FROM catalogue_items WHERE id = ANY($1::uuid[]) AND status='active'`, [altIds])).rows, plantId || null) : [];
      const labelOf = (k: string) => attributes.find((a: any) => a.key === k)?.label ?? k.replace(/[_-]/g, ' ').replace(/^\w/, (x: string) => x.toUpperCase());
      const alternatives = altItems.map((a: any) => {
        const ap = apprRows.find((r) => r.item_id === a.id || r.alternative_item_id === a.id);
        const keys = [...new Set([...Object.keys(it.specs ?? {}), ...Object.keys(a.specs ?? {})])];
        return { id: a.id, name: a.name, brand: a.brand, mpn: a.mpn, category: a.category, imageId: a.imageId, uom: a.uom, status: ap ? 'approved' : 'suggested', note: ap?.note ?? null, source: a.source,
          diff: keys.map((k) => ({ key: k, label: labelOf(k), here: it.specs?.[k] ?? null, there: a.specs?.[k] ?? null, same: (it.specs?.[k] ?? null) !== null && String(it.specs?.[k]).toLowerCase() === String(a.specs?.[k] ?? '').toLowerCase() })) };
      }).sort((a: any, b: any) => Number(b.status === 'approved') - Number(a.status === 'approved'));
      const aliases = (await c.query(`SELECT kind, value FROM item_aliases WHERE item_id=$1 ORDER BY kind, value`, [id])).rows;
      return { source: sv, alternatives, aliases, id: it.id, name: it.name, description: it.description, brand: it.brand, manufacturer: it.manufacturer, mpn: it.mpn, category: it.category, uom: it.uom, specs: it.specs, version: it.version,
        procmartServiceability: it.procmart_serviceability, codes, equivalents, assets, attributes, related, saved, plant, supplies, routing: routingItem.routing, nextStep };
    });
  }

  // ───────── saved items ─────────
  @Perm('catalogue:read')
  @Post('saved/:itemId')
  async save(@CurrentCtx() ctx: Ctx, @Param('itemId') itemId: string) {
    if (!isId(itemId)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1`, [itemId])).rowCount) throw new NotFoundException();
      await c.query(`INSERT INTO saved_items(tenant_id,user_id,item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.tenantId, ctx.userId, itemId]);
      return { saved: true };
    });
  }
  @Perm('catalogue:read')
  @Delete('saved/:itemId')
  unsave(@CurrentCtx() ctx: Ctx, @Param('itemId') itemId: string) {
    if (!isId(itemId)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => { await c.query(`DELETE FROM saved_items WHERE user_id=$1 AND item_id=$2`, [ctx.userId, itemId]); return { saved: false }; });
  }
  @Perm('catalogue:read')
  @Get('saved')
  async listSaved(@CurrentCtx() ctx: Ctx, @Query('plantId') plantId?: string) {
    if (plantId && !isId(plantId)) throw new BadRequestException('bad plantId');
    return this.db.tx(ctx, async (c) => {
      if (plantId && !(await canAtNode(c, ctx, 'catalogue:read', plantId))) throw new BadRequestException('Plant not in your scope');
      const rows = (await c.query(`SELECT i.* FROM saved_items s JOIN catalogue_items i ON i.id=s.item_id WHERE s.user_id=$1 AND i.status='active' ORDER BY s.created_at DESC`, [ctx.userId])).rows;
      return (await enrichItems(c, rows, plantId || null)).map((i: any) => ({ ...i, saved: true, lowestPrice: lowest(i) }));
    });
  }

  // ───────── cart line editing (drawer) ─────────
  @Perm('buying:request')
  @Post('cart/lines/:id')
  setQty(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: QtyDto) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`UPDATE cart_lines cl SET qty=coalesce($2,cl.qty), need_by=coalesce($4::date,cl.need_by) FROM carts ca WHERE cl.id=$1 AND ca.id=cl.cart_id AND ca.user_id=$3 AND ca.status='open' RETURNING cl.id`, [id, b.qty ?? null, ctx.userId, b.needBy ?? null]);
      if (!r.rowCount) throw new NotFoundException(); return { ok: true };
    });
  }
  @Perm('buying:request')
  @Delete('cart/lines/:id')
  removeLine(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`DELETE FROM cart_lines cl USING carts ca WHERE cl.id=$1 AND ca.id=cl.cart_id AND ca.user_id=$2 AND ca.status='open' RETURNING cl.id`, [id, ctx.userId]);
      if (!r.rowCount) throw new NotFoundException(); return { ok: true };
    });
  }

  // ───────── orders (order streams) ─────────
  @Perm('buying:request')
  @Get('orders')
  async orders(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read');
      return (await c.query(
        `SELECT st.id, st.status, st.po_reference AS "po", st.pr_reference AS "pr", st.status_at AS "statusAt", r.number AS requirement, r.id AS "requirementId", n.name AS plant, s.legal_name AS supplier,
                (SELECT count(*) FROM requirement_lines WHERE stream_id=st.id)::int AS lines,
                coalesce((SELECT sum(qty*unit_price) FROM requirement_lines WHERE stream_id=st.id),0)::float AS value,
                (SELECT max(expected_date) FROM shipments WHERE stream_id=st.id) AS "expectedDate"
           FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=st.plant_node_id LEFT JOIN suppliers s ON s.id=st.supplier_id
          WHERE r.requester_id=$2 OR $3 OR r.plant_node_id = ANY($1::uuid[]) ORDER BY st.status_at DESC LIMIT 300`, [vis ?? [], ctx.userId, vis === null])).rows;
    });
  }

  @Perm('buying:request')
  @Get('orders/:id')
  async order(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const st = (await c.query(`SELECT st.*, r.number AS requirement, r.requester_id, n.name AS plant, s.legal_name AS supplier, s.contact_email AS "supplierEmail" FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=st.plant_node_id LEFT JOIN suppliers s ON s.id=st.supplier_id WHERE st.id=$1`, [id])).rows[0];
      if (!st || (st.requester_id !== ctx.userId && !(await canAtNode(c, ctx, 'buying:read', st.plant_node_id)))) throw new NotFoundException();
      const q = await lineQuantities(c, id);
      const lines = (await c.query(`SELECT rl.id, rl.line_no AS "lineNo", i.name AS item, i.id AS "itemId", rl.uom, rl.unit_price::float AS "unitPrice", rl.need_by AS "needBy" FROM requirement_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.stream_id=$1 ORDER BY rl.line_no`, [id])).rows.map((l) => ({ ...l, ...q.find((x) => x.lineId === l.id) }));
      const shipments = (await c.query(`SELECT asn_number AS asn, carrier, tracking_ref AS "trackingRef", expected_date AS "expectedDate", at FROM shipments WHERE stream_id=$1 ORDER BY at`, [id])).rows;
      const grn = (await c.query(`SELECT grn_number AS "grn", sum(qty_accepted)::float AS accepted, sum(qty_rejected)::float AS rejected, max(at) AS at, bool_and(simulated) AS simulated FROM grn_receipts WHERE stream_id=$1 GROUP BY grn_number ORDER BY max(at)`, [id])).rows;
      const invoices = (await c.query(`SELECT invoice_number AS "invoiceNumber", amount::float AS amount, status, at FROM invoices WHERE stream_id=$1`, [id])).rows;
      const followUps = (await c.query(`SELECT kind, channel, status, simulated, at FROM follow_ups WHERE stream_id=$1 ORDER BY at`, [id])).rows;
      const events = (await c.query(`SELECT kind, detail, simulated, at FROM order_events WHERE stream_id=$1 ORDER BY id`, [id])).rows;
      return { id: st.id, status: st.status, po: st.po_reference, pr: st.pr_reference, requirement: st.requirement, requirementId: st.requirement_id, plant: st.plant, supplier: st.supplier, statusAt: st.status_at, lines, shipments, grn, invoices, followUps, events };
    });
  }

  // ───────── supplier overview ─────────
  @Perm('suppliers:read')
  @Get('suppliers/:id/overview')
  async supplier(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const s = (await c.query(`SELECT id, legal_name AS "legalName", tax_id AS "taxId", status, is_procmart AS "isProcmart", contact_email AS "contactEmail", contact_phone AS "contactPhone" FROM suppliers WHERE id=$1`, [id])).rows[0];
      if (!s) throw new NotFoundException();
      const erpCodes = (await c.query(`SELECT e.code AS server, sc.vendor_code AS "vendorCode" FROM supplier_erp_codes sc JOIN erp_systems e ON e.id=sc.erp_system_id WHERE sc.supplier_id=$1 ORDER BY e.code`, [id])).rows;
      const contracts = hasPerm(ctx, 'contracts:read') ? (await c.query(`SELECT ct.id, ct.number, ct.contract_type AS type, ct.status, ct.valid_from AS "validFrom", ct.valid_to AS "validTo", (SELECT count(*) FROM contract_lines WHERE contract_id=ct.id AND status='published')::int AS lines FROM contracts ct WHERE ct.supplier_id=$1 ORDER BY ct.valid_to DESC NULLS LAST`, [id])).rows : [];
      const orders = (await c.query(`SELECT st.id, st.status, st.po_reference AS po, r.number AS requirement, n.name AS plant, coalesce((SELECT sum(qty*unit_price) FROM requirement_lines WHERE stream_id=st.id),0)::float AS value, st.status_at AS "statusAt"
          FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=st.plant_node_id WHERE st.supplier_id=$1 ORDER BY st.status_at DESC LIMIT 15`, [id])).rows;
      const perf = (await c.query(`SELECT count(DISTINCT st.id)::int AS orders, coalesce(sum(g.acc),0)::float AS accepted, coalesce(sum(g.rej),0)::float AS rejected, coalesce(sum(rl.qty) FILTER (WHERE g.acc IS NOT NULL OR g.rej IS NOT NULL),0)::float AS ordered
          FROM streams st JOIN requirement_lines rl ON rl.stream_id=st.id LEFT JOIN LATERAL (SELECT sum(qty_accepted) AS acc, sum(qty_rejected) AS rej FROM grn_receipts WHERE requirement_line_id=rl.id HAVING count(*)>0) g ON true WHERE st.supplier_id=$1`, [id])).rows[0];
      const items = (await c.query(`SELECT DISTINCT i.id, i.name FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id JOIN catalogue_items i ON i.id=cl.item_id WHERE ct.supplier_id=$1 AND ct.status='published' AND cl.status='published' ORDER BY i.name LIMIT 30`, [id])).rows;
      const pct = (n: number, d: number) => (d > 0 ? +((n / d) * 100).toFixed(1) : null);
      return { ...s, erpCodes, contracts, orders, items, performance: { orders: perf.orders, fillRate: pct(perf.accepted, perf.ordered), rejectionRate: pct(perf.rejected, perf.accepted + perf.rejected) } };
    });
  }

  // ───────── home summary (work, not marketing) ─────────
  @Perm('buying:request')
  @Get('home')
  async home(@CurrentCtx() ctx: Ctx, @Query('plantId') plantId?: string) {
    if (plantId && !isId(plantId)) throw new BadRequestException('bad plantId');
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read');
      const scopeSql = `(r.requester_id=$2 OR $3 OR r.plant_node_id = ANY($1::uuid[]))`; const sp = [vis ?? [], ctx.userId, vis === null];
      const cartCount = plantId ? (await c.query(`SELECT count(*)::int AS n FROM cart_lines cl JOIN carts ca ON ca.id=cl.cart_id WHERE ca.user_id=$1 AND ca.plant_node_id=$2 AND ca.status='open'`, [ctx.userId, plantId])).rows[0].n : 0;
      const requirements = (await c.query(`SELECT r.id, r.number, r.status, r.created_at AS "createdAt", n.name AS plant, (SELECT count(*) FROM requirement_lines WHERE requirement_id=r.id)::int AS lines FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id WHERE ${scopeSql} ORDER BY r.created_at DESC LIMIT 4`, sp)).rows;
      const orderStats = (await c.query(`SELECT count(*) FILTER (WHERE st.status NOT IN ('paid','closed','pr_failed'))::int AS open,
            count(*) FILTER (WHERE st.status IN ('dispatched','partially_dispatched','partially_received') AND EXISTS (SELECT 1 FROM shipments sh WHERE sh.stream_id=st.id AND sh.expected_date < current_date))::int AS late,
            count(*) FILTER (WHERE st.status='po_released')::int AS awaiting_ack
          FROM streams st JOIN requirements r ON r.id=st.requirement_id WHERE ${scopeSql}`, sp)).rows[0];
      const attention = (await c.query(`SELECT st.id, st.status, st.po_reference AS po, s.legal_name AS supplier, r.number AS requirement, n.name AS plant, (SELECT max(expected_date) FROM shipments WHERE stream_id=st.id) AS "expectedDate"
          FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=st.plant_node_id LEFT JOIN suppliers s ON s.id=st.supplier_id
          WHERE ${scopeSql} AND st.status NOT IN ('paid','closed','pr_failed','pr_requested','pr_created') ORDER BY st.status_at DESC LIMIT 4`, sp)).rows;
      const out: any = { cartCount, requirements, orders: { open: orderStats.open, late: orderStats.late, awaitingAck: orderStats.awaiting_ack, recent: attention },
        savedCount: (await c.query(`SELECT count(*)::int AS n FROM saved_items WHERE user_id=$1`, [ctx.userId])).rows[0].n, tasks: {} };
      if (hasPerm(ctx, 'buying:source') || hasPerm(ctx, 'buying:approve')) {
        out.tasks.openExceptions = (await c.query(`SELECT count(*)::int AS n FROM exceptions e JOIN requirements r ON r.id=e.requirement_id WHERE e.status='open' AND ${scopeSql}`, sp)).rows[0].n;
        out.tasks.rfqsToAward = hasPerm(ctx, 'buying:approve') ? (await c.query(`SELECT count(*)::int AS n FROM rfqs f JOIN requirements r ON r.id=f.requirement_id WHERE f.status='closed' AND ${scopeSql}`, sp)).rows[0].n : 0;
        out.tasks.waitingForQuotes = hasPerm(ctx, 'buying:source') ? (await c.query(`SELECT count(*)::int AS n FROM requirement_lines rl JOIN requirements r ON r.id=rl.requirement_id WHERE rl.route='sourcing' AND ${scopeSql} AND NOT EXISTS (SELECT 1 FROM rfq_lines x JOIN rfqs f ON f.id=x.rfq_id WHERE x.requirement_line_id=rl.id AND f.status IN ('open','closed','awarded'))`, sp)).rows[0].n : 0;
      }
      if (hasPerm(ctx, 'contracts:review')) out.tasks.reviewQueue = (await c.query(`SELECT count(*)::int AS n FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id WHERE cl.status='needs_review' AND ct.status='in_review'`)).rows[0].n;
      if (hasPerm(ctx, 'contracts:read')) out.expiringContracts = (await c.query(`SELECT ct.id, ct.number, s.legal_name AS supplier, ct.valid_to AS "validTo", (ct.valid_to::date - current_date)::int AS days FROM contracts ct LEFT JOIN suppliers s ON s.id=ct.supplier_id WHERE ct.status='published' AND ct.valid_to <= current_date + 90 ORDER BY ct.valid_to LIMIT 3`)).rows;
      if (plantId) {
        const top = (await c.query(`SELECT item_id, count(*)::int AS n FROM (SELECT rl.item_id FROM requirement_lines rl JOIN requirements r ON r.id=rl.requirement_id JOIN catalogue_items ci ON ci.id=rl.item_id WHERE r.plant_node_id=$1 AND ci.source='catalogue'
              UNION ALL SELECT item_id FROM po_history WHERE plant_node_id=$1 AND item_id IS NOT NULL) x GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [plantId])).rows;
        const rows = top.length ? (await c.query(`SELECT * FROM catalogue_items WHERE id = ANY($1::uuid[]) AND status='active'`, [top.map((t) => t.item_id)])).rows : [];
        const en = await enrichItems(c, rows, plantId);
        out.popular = top.map((t) => en.find((e: any) => e.id === t.item_id)).filter(Boolean).map((e: any) => ({ id: e.id, name: e.name, brand: e.brand, mpn: e.mpn, imageId: e.imageId, category: e.category, uom: e.uom, source: e.source, timesBought: top.find((t) => t.item_id === e.id)!.n }));
      } else out.popular = [];
      const myAttention = (await c.query(`SELECT count(*)::int AS n, min(r.id::text) AS rid FROM exceptions e JOIN requirements r ON r.id=e.requirement_id WHERE e.status='open' AND r.requester_id=$1`, [ctx.userId])).rows[0];
      out.alerts = [
        ...(cartCount > 0 ? [{ kind: 'draft', text: `${cartCount} item${cartCount === 1 ? '' : 's'} in your draft requirement`, href: '/?cart=1' }] : []),
        ...(myAttention.n > 0 ? [{ kind: 'attention', text: `${myAttention.n} of your requirements need attention`, href: `/requirements/${myAttention.rid}` }] : []),
        ...(orderStats.awaiting_ack > 0 && orderStats.late > 0 ? [{ kind: 'late', text: `${orderStats.late} order${orderStats.late === 1 ? ' is' : 's are'} late`, href: '/activity?tab=orders&f=late' }] : []),
      ];
      return out;
    });
  }
}
