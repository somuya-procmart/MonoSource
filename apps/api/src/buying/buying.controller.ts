import { startRun } from './agentic';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, Min, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches } from 'class-validator';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm, visibleNodeIds } from '../common/security';
import { applicableLines } from '../contracts/coverage';
import { lineQuantities } from './orders.controller';
import { AllocationEntry, ContractCandidate, Decision, routeLine } from './routing';

class AddToCartDto {
  @IsUUID() plantId: string;
  @IsUUID() itemId: string;
  @IsNumber() @IsPositive() qty: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) needBy?: string;
  @IsOptional() @IsUUID() contractLineId?: string;
  @IsOptional() @IsIn(['buy', 'source']) intent?: 'buy' | 'source';
  @IsOptional() @IsString() note?: string;
}
class AllocationDto {
  @IsUUID() scopeNodeId: string;
  @IsOptional() @IsString() category?: string;
  @IsIn([1, 2, 3]) model: 1 | 2 | 3;
  @IsOptional() @IsString() approvedByCustomer?: string;
  @IsOptional() @IsString() approvedByProcmart?: string;
  @IsOptional() @IsIn(['draft', 'active']) status?: 'draft' | 'active';
}
class PolicyDto {
  @IsOptional() arcPriorityOverDirect?: boolean | null;
  @IsOptional() procmartMayBid?: boolean | null;
  @IsOptional() @IsInt() @Min(1) minQuotes?: number;
  @IsOptional() followUp?: { ackHours: number; dispatchHours: number; deliveryHours: number; escalateAfter: number; channels: string[] };
}

const today = () => new Date().toISOString().slice(0, 10);

async function loadAllocations(c: PoolClient, plantId: string): Promise<(AllocationEntry & { _cat: string | null })[]> {
  const r = await c.query(
    `WITH RECURSIVE up AS (SELECT id, parent_id, 0 AS depth FROM org_nodes WHERE id=$1
        UNION ALL SELECT n.id, n.parent_id, up.depth+1 FROM org_nodes n JOIN up ON n.id=up.parent_id)
     SELECT a.model, a.category, up.depth AS "scopeDepth", a.valid_from AS "validFrom", a.valid_to AS "validTo"
       FROM model_allocations a JOIN up ON up.id=a.scope_node_id WHERE a.status='active'`, [plantId]);
  return r.rows as any;
}

/** Suppliers holding a vendor code on this plant's ERP server (null when the plant has no ERP set up). */
export async function vendorCodeSet(c: PoolClient, plantId: string): Promise<Set<string> | null> {
  const e = (await c.query(`SELECT erp_system_id FROM org_nodes WHERE id=$1`, [plantId])).rows[0]?.erp_system_id;
  if (!e) return null;
  return new Set((await c.query(`SELECT supplier_id FROM supplier_erp_codes WHERE erp_system_id=$1`, [e])).rows.map((r) => r.supplier_id));
}

/** Routes each cart line independently (BRD: routing is per requirement line). Used for preview and for submit. */
export async function routeLines(c: PoolClient, plantId: string, lines: { item_id: string; qty: string; uom: string; contract_line_id?: string | null; intent?: string }[]) {
  const itemIds = lines.map((l) => l.item_id);
  const items = new Map((await c.query(`SELECT id, uom, category, status, source FROM catalogue_items WHERE id = ANY($1::uuid[])`, [itemIds])).rows.map((r) => [r.id, r]));
  const pol = (await c.query(`SELECT arc_priority_over_direct FROM tenant_policies LIMIT 1`)).rows[0];
  const allocations = await loadAllocations(c, plantId);
  const cov = await applicableLines(c, plantId, itemIds, today());
  const vendorOk = await vendorCodeSet(c, plantId);
  return lines.map((l): Decision => {
    const it = items.get(l.item_id);
    const cands: ContractCandidate[] = cov.filter((x) => x.item_id === l.item_id).map((x) => ({
      contractLineId: x.contract_line_id, contractType: x.contract_type, supplierId: x.supplier_id,
      netPrice: x.net_price === null ? null : +x.net_price, uom: x.uom, moq: x.moq === null ? null : +x.moq,
      qtyCap: x.qty_cap === null ? null : +x.qty_cap, usedQty: +x.used_qty, validTo: x.valid_to, scopeDepth: x.scope_depth, contractNumber: x.contract_number, vendorCodeMissing: !!(vendorOk && x.supplier_id && !vendorOk.has(x.supplier_id)) }));
    return routeLine({
      line: { qty: +l.qty, uom: l.uom, itemUom: it?.uom, itemActive: it?.status === 'active', category: it?.category ?? null, intent: (l.intent as any) ?? 'buy', requested: it?.source === 'requested' },
      allocations, policy: { arcPriorityOverDirect: pol?.arc_priority_over_direct ?? null }, candidates: cands, today: today(), preferredContractLineId: l.contract_line_id ?? null });
  });
}

@Controller()
export class BuyingController {
  constructor(private db: Db) {}

  // ───────── cart ─────────
  @Perm('buying:request')
  @Post('cart/items')
  async addToCart(@CurrentCtx() ctx: Ctx, @Body() b: AddToCartDto) {
    return this.db.tx(ctx, async (c) => {
      const plant = (await c.query(`SELECT id FROM org_nodes WHERE id=$1 AND level_type='plant'`, [b.plantId])).rows[0];
      if (!plant) throw new BadRequestException('Not a plant');
      if (!(await canAtNode(c, ctx, 'buying:request', b.plantId))) throw new ForbiddenException('You cannot raise requirements for this plant');
      const item = (await c.query(`SELECT uom FROM catalogue_items WHERE id=$1 AND status='active'`, [b.itemId])).rows[0];
      if (!item) throw new BadRequestException('Unknown or inactive item');
      let cart = (await c.query(`SELECT id FROM carts WHERE user_id=$1 AND plant_node_id=$2 AND status='open'`, [ctx.userId, b.plantId])).rows[0];
      if (!cart) cart = (await c.query(`INSERT INTO carts(tenant_id,user_id,plant_node_id) VALUES ($1,$2,$3) RETURNING id`, [ctx.tenantId, ctx.userId, b.plantId])).rows[0];
      await c.query(
        `INSERT INTO cart_lines(tenant_id,cart_id,item_id,qty,uom,need_by,contract_line_id,intent,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (cart_id,item_id) DO UPDATE SET qty = cart_lines.qty + EXCLUDED.qty, need_by = coalesce(EXCLUDED.need_by, cart_lines.need_by), contract_line_id = coalesce(EXCLUDED.contract_line_id, cart_lines.contract_line_id), intent = EXCLUDED.intent, note = coalesce(EXCLUDED.note, cart_lines.note)`,
        [ctx.tenantId, cart.id, b.itemId, b.qty, item.uom, b.needBy ?? null, b.contractLineId ?? null, b.intent ?? 'buy', b.note ?? null]);
      return { cartId: cart.id };
    });
  }

  /** The cart with the routing result for every line, shown to the requester BEFORE submission. */
  @Perm('buying:request')
  @Get('cart')
  async cart(@CurrentCtx() ctx: Ctx, @Query('plantId') plantId: string) {
    if (!/^[0-9a-f-]{36}$/.test(plantId ?? '')) throw new BadRequestException('plantId required');
    return this.db.tx(ctx, async (c) => {
      const cart = (await c.query(`SELECT id FROM carts WHERE user_id=$1 AND plant_node_id=$2 AND status='open'`, [ctx.userId, plantId])).rows[0];
      if (!cart) return { cartId: null, lines: [] };
      const lines = (await c.query(`SELECT cl.id, cl.item_id, cl.qty, cl.uom, cl.need_by, cl.contract_line_id, cl.intent, cl.note, i.name, i.brand, i.category, i.source AS item_source, (SELECT id FROM item_assets a WHERE a.item_id=i.id AND a.kind='image' ORDER BY created_at LIMIT 1) AS image_id FROM cart_lines cl JOIN catalogue_items i ON i.id=cl.item_id WHERE cl.cart_id=$1 ORDER BY i.name`, [cart.id])).rows;
      const decisions = await routeLines(c, plantId, lines);
      return { cartId: cart.id, lines: lines.map((l, i) => ({ ...l, routing: decisions[i] })) };
    });
  }

  @Perm('buying:request')
  @Post('cart/:id/submit')
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const cart = (await c.query(`SELECT * FROM carts WHERE id=$1 AND user_id=$2 FOR UPDATE`, [id, ctx.userId])).rows[0];
      if (!cart) throw new NotFoundException();
      if (cart.status !== 'open') throw new ConflictException('Cart already submitted'); // a PR can be created only once per requirement line
      const lines = (await c.query(`SELECT * FROM cart_lines WHERE cart_id=$1 ORDER BY id`, [id])).rows;
      if (!lines.length) throw new BadRequestException('Cart is empty');
      const decisions = await routeLines(c, cart.plant_node_id, lines);

      const num = `REQ-${String((await c.query(`SELECT nextval('requirement_seq') AS n`)).rows[0].n).padStart(6, '0')}`;
      const req = (await c.query(`INSERT INTO requirements(tenant_id,number,plant_node_id,requester_id,cart_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [ctx.tenantId, num, cart.plant_node_id, ctx.userId, id])).rows[0];

      // Streams: lines with the same plant + model + supplier travel together (BR-RTE-04).
      const streams = new Map<string, string>();
      for (const [i, l] of lines.entries()) {
        const d = decisions[i];
        let streamId: string | null = null;
        if ((d.route === 'arc' || d.route === 'direct') && d.supplierId && d.model) {
          const key = `${d.model}|${d.supplierId}`;
          if (!streams.has(key)) {
            const s = (await c.query(`INSERT INTO streams(tenant_id,requirement_id,plant_node_id,model,supplier_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [ctx.tenantId, req.id, cart.plant_node_id, d.model, d.supplierId])).rows[0];
            streams.set(key, s.id);
          }
          streamId = streams.get(key)!;
        }
        const lineRow = await c.query(
          `INSERT INTO requirement_lines(tenant_id,requirement_id,line_no,item_id,qty,uom,need_by,route,model,fee_treatment,contract_line_id,supplier_id,stream_id,unit_price,routing_trace,intent,note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [ctx.tenantId, req.id, i + 1, l.item_id, l.qty, l.uom, l.need_by, d.route, d.model, d.feeTreatment, d.contractLineId, d.supplierId, streamId, d.unitPrice, JSON.stringify(d.trace), l.intent ?? 'buy', l.note ?? null]);
        if (d.route === 'exception')
          await c.query(`INSERT INTO exceptions(tenant_id,kind,requirement_id,requirement_line_id,detail) VALUES ($1,'routing',$2,$3,$4)`,
            [ctx.tenantId, req.id, lineRow.rows[0].id, String(d.trace.at(-1)?.detail ?? 'Routing needs a decision')]);
      }
      for (const sid of streams.values()) {
        // Same transaction as the business write: either both exist or neither does.
        await c.query(`INSERT INTO outbox(tenant_id,kind,payload,idempotency_key) VALUES ($1,'erp.submit_pr',$2,$3)`, [ctx.tenantId, JSON.stringify({ streamId: sid }), `pr:${sid}`]);
        await c.query(`UPDATE streams SET status='pr_requested' WHERE id=$1`, [sid]);
        await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail) VALUES ($1,$2,$3,'pr_requested','{}')`, [ctx.tenantId, req.id, sid]);
      }
      await c.query(`UPDATE carts SET status='submitted' WHERE id=$1`, [id]);
      await c.query(`INSERT INTO order_events(tenant_id,requirement_id,kind,detail) VALUES ($1,$2,'requirement_submitted',$3)`, [ctx.tenantId, req.id, JSON.stringify({ lines: lines.length, streams: streams.size })]);
      await audit(c, ctx, 'requirement.submitted', 'requirement', req.id, { number: num, routes: decisions.map((d) => d.route) });
      await startRun(c, ctx, req.id); // simulated agent activity + milestone notification
      return { requirementId: req.id, number: num, streams: streams.size, lines: decisions.map((d) => ({ route: d.route, model: d.model, fee: d.feeTreatment })) };
    });
  }

  // ───────── tracking ─────────
  @Perm('buying:request')
  @Get('requirements')
  async list(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read');
      return (await c.query(
        `SELECT r.id, r.number, r.status, r.created_at AS "createdAt", n.name AS plant, u.name AS requester,
                (SELECT count(*) FROM requirement_lines WHERE requirement_id=r.id) AS lines,
                (SELECT count(*) FROM streams WHERE requirement_id=r.id) AS streams
           FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id JOIN users u ON u.id=r.requester_id
          WHERE r.requester_id=$2 OR $3 OR r.plant_node_id = ANY($1::uuid[])
          ORDER BY r.created_at DESC LIMIT 200`, [vis ?? [], ctx.userId, vis === null])).rows;
    });
  }

  @Perm('buying:request')
  @Get('requirements/:id')
  async one(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query(`SELECT r.*, n.name AS plant_name FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id WHERE r.id=$1`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.requester_id !== ctx.userId && !(await canAtNode(c, ctx, 'buying:read', r.plant_node_id))) throw new NotFoundException();
      const lines = (await c.query(`SELECT rl.*, i.name AS item_name, s.legal_name AS supplier_name FROM requirement_lines rl JOIN catalogue_items i ON i.id=rl.item_id LEFT JOIN suppliers s ON s.id=rl.supplier_id WHERE requirement_id=$1 ORDER BY line_no`, [id])).rows;
      const streams = (await c.query(`SELECT st.*, s.legal_name AS supplier_name FROM streams st LEFT JOIN suppliers s ON s.id=st.supplier_id WHERE requirement_id=$1`, [id])).rows;
      const events = (await c.query(`SELECT kind, detail, simulated, at FROM order_events WHERE requirement_id=$1 ORDER BY id`, [id])).rows;
      for (const st of streams) {
        st.quantities = await lineQuantities(c, st.id);
        st.shipments = (await c.query(`SELECT asn_number AS asn, carrier, tracking_ref AS "trackingRef", expected_date AS "expectedDate", at FROM shipments WHERE stream_id=$1 ORDER BY at`, [st.id])).rows;
        st.followUps = (await c.query(`SELECT kind, channel, status, detail, simulated, at FROM follow_ups WHERE stream_id=$1 ORDER BY at`, [st.id])).rows;
        st.invoices = (await c.query(`SELECT invoice_number AS "invoiceNumber", amount, status FROM invoices WHERE stream_id=$1`, [st.id])).rows;
      }
      return { ...r, lines, streams, events };
    });
  }

  // ───────── configuration: allocation register & policy ─────────
  @Perm('allocation:write')
  @Post('allocations')
  createAllocation(@CurrentCtx() ctx: Ctx, @Body() b: AllocationDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM org_nodes WHERE id=$1`, [b.scopeNodeId])).rowCount) throw new BadRequestException('Unknown scope node');
      if (b.status === 'active' && !(b.approvedByCustomer && b.approvedByProcmart))
        throw new BadRequestException('An allocation goes live only with both customer and ProcMart approvals recorded (BR-MOD-01)');
      const r = await c.query(
        `INSERT INTO model_allocations(tenant_id,scope_node_id,category,model,approved_by_customer,approved_by_procmart,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, b.scopeNodeId, b.category ?? null, b.model, b.approvedByCustomer ?? null, b.approvedByProcmart ?? null, b.status ?? 'draft']);
      await audit(c, ctx, 'allocation.created', 'model_allocation', r.rows[0].id, b);
      return r.rows[0];
    });
  }

  @Perm('allocation:read')
  @Get('allocations')
  allocations(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT a.id, a.model, a.category, a.status, n.name AS scope FROM model_allocations a JOIN org_nodes n ON n.id=a.scope_node_id ORDER BY a.created_at`)).rows);
  }

  @Perm('policy:write')
  @Post('policy')
  setPolicy(@CurrentCtx() ctx: Ctx, @Body() b: PolicyDto) {
    return this.db.tx(ctx, async (c) => {
      await c.query(
        `UPDATE tenant_policies SET arc_priority_over_direct = CASE WHEN $1::boolean IS NULL AND $3 THEN arc_priority_over_direct ELSE $1 END,
                                    procmart_may_bid = CASE WHEN $2::boolean IS NULL AND $4 THEN procmart_may_bid ELSE $2 END, updated_at=now()`,
        [b.arcPriorityOverDirect ?? null, b.procmartMayBid ?? null, b.arcPriorityOverDirect === undefined, b.procmartMayBid === undefined]);
      if (b.followUp) await c.query(`UPDATE tenant_policies SET thresholds = jsonb_set(thresholds, '{followUp}', $1::jsonb)`, [JSON.stringify(b.followUp)]);
      if (b.minQuotes !== undefined) await c.query(`UPDATE tenant_policies SET thresholds = jsonb_set(thresholds, '{minQuotes}', to_jsonb($1::int))`, [b.minQuotes]);
      await audit(c, ctx, 'policy.updated', 'tenant_policy', ctx.tenantId, b);
      return (await c.query(`SELECT arc_priority_over_direct AS "arcPriorityOverDirect", procmart_may_bid AS "procmartMayBid", (thresholds->>'minQuotes')::int AS "minQuotes", thresholds->'followUp' AS "followUp" FROM tenant_policies`)).rows[0];
    });
  }

  @Perm('allocation:read')
  @Get('policy')
  policy(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(`SELECT arc_priority_over_direct AS "arcPriorityOverDirect", procmart_may_bid AS "procmartMayBid", (thresholds->>'minQuotes')::int AS "minQuotes", thresholds->'followUp' AS "followUp" FROM tenant_policies`)).rows[0]);
  }
}

