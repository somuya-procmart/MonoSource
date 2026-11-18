import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm, visibleNodeIds } from '../common/security';
import { canInviteProcmart, QuoteLineView, rankQuotes, readMinQuotes } from './sourcing';

class CreateRfqDto {
  @IsUUID() requirementId: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) requirementLineIds: string[];
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) supplierIds: string[];
}
export class QuoteLineDto {
  @IsUUID() rfqLineId: string;
  @IsNumber() @IsPositive() unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) freightPerUnit?: number;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsString() uom: string;
}
class QuoteDto {
  @IsUUID() supplierId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
}
class RecommendDto { @IsUUID() rfqLineId: string; @IsUUID() quoteLineId: string }
class AwardItemDto { @IsUUID() rfqLineId: string; @IsUUID() quoteLineId: string; @IsOptional() @IsString() reason?: string }
class AwardDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AwardItemDto) awards: AwardItemDto[] }
class ResolveDto { @IsString() resolution: string }


/** Shared by staff entry and the supplier portal: only invited suppliers, open RFQ, UOM must match, one quote per supplier. */
export async function recordQuote(c: PoolClient, ctx: Ctx, rfq: any, supplierId: string, qlines: QuoteLineDto[]) {
  if (rfq.status !== 'open') throw new ConflictException(`RFQ is ${rfq.status}`);
  if (!(await c.query(`SELECT 1 FROM rfq_invitations WHERE rfq_id=$1 AND supplier_id=$2`, [rfq.id, supplierId])).rowCount) throw new BadRequestException('Supplier was not invited');
  const lines = (await c.query(`SELECT id, uom FROM rfq_lines WHERE rfq_id=$1`, [rfq.id])).rows;
  for (const l of qlines) {
    const rl = lines.find((x) => x.id === l.rfqLineId);
    if (!rl) throw new BadRequestException('Line is not part of this RFQ');
    if (l.uom.trim().toUpperCase() !== rl.uom) throw new BadRequestException(`Quote UOM ${l.uom} differs from requested ${rl.uom}; no conversion factor exists`);
  }
  if (new Set(qlines.map((l) => l.rfqLineId)).size !== qlines.length) throw new BadRequestException('Duplicate line in quote');
  let q;
  try { q = (await c.query(`INSERT INTO quotes(tenant_id,rfq_id,supplier_id,entered_by) VALUES ($1,$2,$3,$4) RETURNING id`, [ctx.tenantId, rfq.id, supplierId, ctx.userId])).rows[0]; }
  catch (e: any) { if (e.code === '23505') throw new ConflictException('This supplier already quoted'); throw e; }
  for (const l of qlines)
    await c.query(`INSERT INTO quote_lines(tenant_id,quote_id,rfq_line_id,unit_price,freight_per_unit,lead_time_days,uom) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, q.id, l.rfqLineId, l.unitPrice, l.freightPerUnit ?? 0, l.leadTimeDays ?? null, l.uom.trim().toUpperCase()]);
  await audit(c, ctx, 'quote.entered', 'quote', q.id, { rfq: rfq.id, supplierId, by: ctx.kind });
  return { id: q.id };
}

const isId = (s: string) => /^[0-9a-f-]{36}$/.test(s);

async function loadRfq(c: PoolClient, ctx: Ctx, id: string, perm: string, lock = false) {
  if (!isId(id)) throw new NotFoundException();
  const rfq = (await c.query(`SELECT * FROM rfqs WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!rfq || !(await canAtNode(c, ctx, perm, rfq.plant_node_id))) throw new NotFoundException();
  return rfq;
}

/** Quote lines for each RFQ line, ranked. Used by the comparison view and the award checks. */
async function comparison(c: PoolClient, rfqId: string) {
  const lines = (await c.query(
    `SELECT rl.id, rl.qty, rl.uom, rl.requirement_line_id, rl.recommended_quote_line_id, i.name AS item_name FROM rfq_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.rfq_id=$1 ORDER BY i.name`, [rfqId])).rows;
  const ql = (await c.query(
    `SELECT ql.id, ql.rfq_line_id, q.supplier_id, s.legal_name, ql.unit_price::float, ql.freight_per_unit::float, ql.landed_unit_cost::float, ql.lead_time_days, ql.uom
       FROM quote_lines ql JOIN quotes q ON q.id=ql.quote_id JOIN suppliers s ON s.id=q.supplier_id WHERE q.rfq_id=$1`, [rfqId])).rows;
  const awards = (await c.query(`SELECT rfq_line_id, quote_line_id, is_l1, reason FROM awards WHERE rfq_id=$1`, [rfqId])).rows;
  return lines.map((l) => {
    const views: QuoteLineView[] = ql.filter((x) => x.rfq_line_id === l.id).map((x) => ({
      quoteLineId: x.id, supplierId: x.supplier_id, supplierName: x.legal_name, unitPrice: x.unit_price, freightPerUnit: x.freight_per_unit, landedUnitCost: x.landed_unit_cost, leadTimeDays: x.lead_time_days, uom: x.uom }));
    return { ...l, ...rankQuotes(views, l.uom), award: awards.find((a) => a.rfq_line_id === l.id) ?? null };
  });
}

@Controller()
export class SourcingController {
  constructor(private db: Db) {}

  /** Requirement lines the routing engine parked for sourcing and that no RFQ covers yet. */
  @Perm('buying:source')
  @Get('sourcing/pending')
  pending(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:source');
      return (await c.query(
        `SELECT rl.id AS "lineId", r.id AS "requirementId", r.number, n.name AS plant, r.plant_node_id AS "plantId", i.name AS item, (i.source = 'requested') AS requested, i.description AS "itemNote", rl.note, rl.intent, rl.qty, rl.uom, r.created_at AS "createdAt"
           FROM requirement_lines rl JOIN requirements r ON r.id=rl.requirement_id JOIN catalogue_items i ON i.id=rl.item_id JOIN org_nodes n ON n.id=r.plant_node_id
          WHERE rl.route='sourcing' AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1))
            AND NOT EXISTS (SELECT 1 FROM rfq_lines x JOIN rfqs f ON f.id=x.rfq_id WHERE x.requirement_line_id=rl.id AND f.status IN ('open','closed','awarded'))
          ORDER BY r.created_at, rl.line_no`, [vis])).rows;
    });
  }

  /** Suppliers that could be invited: active, and holding a vendor code on the plant's ERP. ProcMart only if policy allows. */
  @Perm('buying:source')
  @Get('rfqs/suggest-suppliers')
  suggest(@CurrentCtx() ctx: Ctx, @Query('requirementId') rid: string) {
    if (!isId(rid ?? '')) throw new BadRequestException('requirementId required');
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query(`SELECT r.plant_node_id, n.erp_system_id FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id WHERE r.id=$1`, [rid])).rows[0];
      if (!r || !(await canAtNode(c, ctx, 'buying:source', r.plant_node_id))) throw new NotFoundException();
      const pol = (await c.query(`SELECT procmart_may_bid FROM tenant_policies LIMIT 1`)).rows[0];
      const pm = canInviteProcmart({ procmartMayBid: pol.procmart_may_bid });
      return (await c.query(
        `SELECT s.id, s.legal_name AS "legalName", s.is_procmart AS "isProcmart" FROM suppliers s
          WHERE s.status='active' AND EXISTS (SELECT 1 FROM supplier_erp_codes sc WHERE sc.supplier_id=s.id AND sc.erp_system_id=$1)
            AND ($2 OR NOT s.is_procmart) ORDER BY s.legal_name`, [r.erp_system_id, pm.ok])).rows;
    });
  }

  @Perm('buying:source')
  @Post('rfqs')
  create(@CurrentCtx() ctx: Ctx, @Body() b: CreateRfqDto) {
    return this.db.tx(ctx, async (c) => {
      const req = (await c.query(`SELECT * FROM requirements WHERE id=$1`, [b.requirementId])).rows[0];
      if (!req || !(await canAtNode(c, ctx, 'buying:source', req.plant_node_id))) throw new NotFoundException();
      const pol = (await c.query(`SELECT procmart_may_bid, thresholds FROM tenant_policies LIMIT 1`)).rows[0];
      // BR-RTE-01: no default is assumed. Without the customer's quote rules, sourcing cannot start.
      const minQuotes = readMinQuotes(pol.thresholds);
      if (minQuotes === null) throw new ConflictException('Sourcing is blocked: the customer has not set the minimum number of quotes (decision Q12)');
      if (b.supplierIds.length < minQuotes) throw new BadRequestException(`Invite at least ${minQuotes} suppliers (customer policy)`);

      const lines = (await c.query(
        `SELECT rl.* FROM requirement_lines rl WHERE rl.requirement_id=$1 AND rl.id = ANY($2::uuid[]) AND rl.route='sourcing'`, [b.requirementId, b.requirementLineIds])).rows;
      if (lines.length !== new Set(b.requirementLineIds).size) throw new BadRequestException('Some lines are not awaiting sourcing for this requirement');
      const busy = await c.query(`SELECT 1 FROM rfq_lines x JOIN rfqs f ON f.id=x.rfq_id WHERE x.requirement_line_id = ANY($1::uuid[]) AND f.status IN ('open','closed','awarded')`, [b.requirementLineIds]);
      if (busy.rowCount) throw new ConflictException('A line is already in an RFQ');

      const plantErp = (await c.query(`SELECT erp_system_id FROM org_nodes WHERE id=$1`, [req.plant_node_id])).rows[0].erp_system_id;
      const sup = (await c.query(`SELECT s.id, s.is_procmart, s.status, s.legal_name FROM suppliers s WHERE s.id = ANY($1::uuid[])`, [b.supplierIds])).rows;
      if (sup.length !== new Set(b.supplierIds).size) throw new BadRequestException('Unknown supplier');
      for (const s of sup) {
        if (s.status !== 'active') throw new BadRequestException(`${s.legal_name} is not active`);
        if (s.is_procmart) { const ok = canInviteProcmart({ procmartMayBid: pol.procmart_may_bid }); if (!ok.ok) throw new ConflictException(ok.why); }
        if (!(await c.query(`SELECT 1 FROM supplier_erp_codes WHERE supplier_id=$1 AND erp_system_id=$2`, [s.id, plantErp])).rowCount)
          throw new BadRequestException(`${s.legal_name} has no vendor code on this plant's ERP; request a vendor-code extension first`);
      }
      const number = `RFQ-${String((await c.query(`SELECT nextval('rfq_seq') AS n`)).rows[0].n).padStart(6, '0')}`;
      const rfq = (await c.query(`INSERT INTO rfqs(tenant_id,number,requirement_id,plant_node_id,min_quotes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [ctx.tenantId, number, b.requirementId, req.plant_node_id, minQuotes, ctx.userId])).rows[0];
      for (const l of lines) await c.query(`INSERT INTO rfq_lines(tenant_id,rfq_id,requirement_line_id,item_id,qty,uom) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, rfq.id, l.id, l.item_id, l.qty, l.uom]);
      for (const s of sup) await c.query(`INSERT INTO rfq_invitations(tenant_id,rfq_id,supplier_id) VALUES ($1,$2,$3)`, [ctx.tenantId, rfq.id, s.id]);
      await c.query(`INSERT INTO order_events(tenant_id,requirement_id,kind,detail) VALUES ($1,$2,'rfq_opened',$3)`, [ctx.tenantId, b.requirementId, JSON.stringify({ rfq: number, invited: sup.length })]);
      await audit(c, ctx, 'rfq.created', 'rfq', rfq.id, { number, suppliers: b.supplierIds, lines: b.requirementLineIds });
      return { id: rfq.id, number };
    });
  }

  @Perm('buying:read')
  @Get('rfqs')
  list(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read');
      return (await c.query(
        `SELECT f.id, f.number, f.status, f.min_quotes AS "minQuotes", n.name AS plant, r.number AS requirement,
                (SELECT count(*) FROM rfq_invitations WHERE rfq_id=f.id) AS invited, (SELECT count(*) FROM quotes WHERE rfq_id=f.id) AS quotes, f.created_at AS "createdAt"
           FROM rfqs f JOIN org_nodes n ON n.id=f.plant_node_id JOIN requirements r ON r.id=f.requirement_id
          WHERE $1::uuid[] IS NULL OR f.plant_node_id = ANY($1) ORDER BY f.created_at DESC`, [vis])).rows;
    });
  }

  @Perm('buying:read')
  @Get('rfqs/:id')
  async one(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(ctx, async (c) => {
      const rfq = await loadRfq(c, ctx, id, 'buying:read');
      const inv = (await c.query(`SELECT s.id, s.legal_name AS name, s.is_procmart AS "isProcmart", EXISTS (SELECT 1 FROM quotes q WHERE q.rfq_id=$1 AND q.supplier_id=s.id) AS quoted FROM rfq_invitations i JOIN suppliers s ON s.id=i.supplier_id WHERE i.rfq_id=$1 ORDER BY s.legal_name`, [id])).rows;
      return { ...rfq, invitations: inv, comparison: await comparison(c, id) };
    });
  }

  /** ProcMart ops enter a supplier's quote on its behalf; suppliers can also quote themselves through the portal. */
  @Perm('buying:source')
  @Post('rfqs/:id/quotes')
  quote(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: QuoteDto) {
    return this.db.tx(ctx, async (c) => {
      const rfq = await loadRfq(c, ctx, id, 'buying:source', true);
      return recordQuote(c, ctx, rfq, b.supplierId, b.lines);
    });
  }

  @Perm('buying:source')
  @Post('rfqs/:id/close')
  close(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(ctx, async (c) => {
      const rfq = await loadRfq(c, ctx, id, 'buying:source', true);
      if (rfq.status !== 'open') throw new ConflictException(`RFQ is ${rfq.status}`);
      const n = (await c.query(`SELECT count(*)::int AS n FROM quotes WHERE rfq_id=$1`, [id])).rows[0].n;
      if (n < rfq.min_quotes) throw new ConflictException(`Only ${n} quote(s) received; customer policy needs ${rfq.min_quotes}`);
      await c.query(`UPDATE rfqs SET status='closed' WHERE id=$1`, [id]);
      await audit(c, ctx, 'rfq.closed', 'rfq', id, { quotes: n });
      return { status: 'closed' };
    });
  }

  /** ProcMart operations recommend; the customer's approver decides. */
  @Perm('buying:source')
  @Post('rfqs/:id/recommend')
  recommend(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: RecommendDto) {
    return this.db.tx(ctx, async (c) => {
      const rfq = await loadRfq(c, ctx, id, 'buying:source', true);
      if (rfq.status !== 'closed') throw new ConflictException('Close the RFQ before recommending');
      const ok = await c.query(`SELECT 1 FROM quote_lines ql JOIN quotes q ON q.id=ql.quote_id WHERE ql.id=$1 AND ql.rfq_line_id=$2 AND q.rfq_id=$3`, [b.quoteLineId, b.rfqLineId, id]);
      if (!ok.rowCount) throw new BadRequestException('Quote line does not belong to that RFQ line');
      await c.query(`UPDATE rfq_lines SET recommended_quote_line_id=$2, recommended_by=$3 WHERE id=$1`, [b.rfqLineId, b.quoteLineId, ctx.userId]);
      await audit(c, ctx, 'rfq.recommended', 'rfq', id, b);
      return { ok: true };
    });
  }

  /** The award is the customer's decision (buying:approve). A non-L1 award needs a written reason. Creates streams → PR via the outbox. */
  @Perm('buying:approve')
  @Post('rfqs/:id/award')
  award(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: AwardDto) {
    return this.db.tx(ctx, async (c) => {
      const rfq = await loadRfq(c, ctx, id, 'buying:approve', true);
      if (rfq.status !== 'closed') throw new ConflictException(`RFQ is ${rfq.status}; only a closed RFQ can be awarded`);
      const cmp = await comparison(c, id);
      const bySupplier = new Map<string, { rfqLineId: string; reqLineId: string; price: number }[]>();
      for (const a of b.awards) {
        const line = cmp.find((x) => x.id === a.rfqLineId);
        if (!line) throw new BadRequestException('Line is not part of this RFQ');
        if (line.award) throw new ConflictException('Line already awarded');
        const q = line.ranked.find((x: any) => x.quoteLineId === a.quoteLineId);
        if (!q) throw new BadRequestException('Quote is not a valid (same-UOM) quote for that line');
        if (!q.isL1 && !a.reason?.trim()) throw new BadRequestException('Awarding to other than L1 needs a recorded reason');
        await c.query(`INSERT INTO awards(tenant_id,rfq_id,rfq_line_id,quote_line_id,is_l1,reason,awarded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, id, a.rfqLineId, a.quoteLineId, q.isL1, a.reason ?? null, ctx.userId]);
        (bySupplier.get(q.supplierId) ?? bySupplier.set(q.supplierId, []).get(q.supplierId)!).push({ rfqLineId: a.rfqLineId, reqLineId: line.requirement_line_id, price: q.unitPrice });
      }
      for (const [supplierId, items] of bySupplier) {
        const st = (await c.query(`INSERT INTO streams(tenant_id,requirement_id,plant_node_id,model,supplier_id,status) VALUES ($1,$2,$3,3,$4,'pr_requested') RETURNING id`, [ctx.tenantId, rfq.requirement_id, rfq.plant_node_id, supplierId])).rows[0];
        for (const it of items) {
          await c.query(`UPDATE requirement_lines SET route='award', model=3, fee_treatment='management_fee', supplier_id=$2, unit_price=$3, stream_id=$4 WHERE id=$1`, [it.reqLineId, supplierId, it.price, st.id]);
          await c.query(`UPDATE awards SET stream_id=$2 WHERE rfq_line_id=$1`, [it.rfqLineId, st.id]);
        }
        await c.query(`INSERT INTO outbox(tenant_id,kind,payload,idempotency_key) VALUES ($1,'erp.submit_pr',$2,$3)`, [ctx.tenantId, JSON.stringify({ streamId: st.id }), `pr:${st.id}`]);
        await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail) VALUES ($1,$2,$3,'awarded',$4)`, [ctx.tenantId, rfq.requirement_id, st.id, JSON.stringify({ rfq: rfq.number })]);
      }
      const left = (await c.query(`SELECT 1 FROM rfq_lines rl WHERE rl.rfq_id=$1 AND NOT EXISTS (SELECT 1 FROM awards a WHERE a.rfq_line_id=rl.id)`, [id])).rowCount;
      if (!left) await c.query(`UPDATE rfqs SET status='awarded' WHERE id=$1`, [id]);
      await audit(c, ctx, 'rfq.awarded', 'rfq', id, { awards: b.awards });
      return { streams: bySupplier.size, rfqStatus: left ? 'closed' : 'awarded' };
    });
  }

  // ───────── exceptions ─────────
  @Perm('buying:read')
  @Get('exceptions')
  exceptions(@CurrentCtx() ctx: Ctx, @Query('status') status = 'open') {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read');
      return (await c.query(
        `SELECT e.id, e.kind, e.detail, e.status, e.resolution, e.created_at AS "createdAt", r.number AS requirement, r.id AS "requirementId", coalesce(i.name, si.name) AS item
           FROM exceptions e LEFT JOIN requirements r ON r.id=e.requirement_id LEFT JOIN requirement_lines rl ON rl.id=e.requirement_line_id LEFT JOIN catalogue_items i ON i.id=rl.item_id
           LEFT JOIN LATERAL (SELECT ci.name FROM requirement_lines x JOIN catalogue_items ci ON ci.id=x.item_id WHERE x.stream_id=e.stream_id LIMIT 1) si ON true
          WHERE e.status=$2 AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) ORDER BY e.created_at DESC LIMIT 200`, [vis, status === 'resolved' ? 'resolved' : 'open'])).rows;
    });
  }

  @Perm('buying:source')
  @Post('exceptions/:id/resolve')
  resolve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: ResolveDto) {
    return this.db.tx(ctx, async (c) => {
      if (!isId(id)) throw new NotFoundException();
      const e = (await c.query(`SELECT e.*, r.plant_node_id FROM exceptions e LEFT JOIN requirements r ON r.id=e.requirement_id WHERE e.id=$1 FOR UPDATE OF e`, [id])).rows[0];
      if (!e || (e.plant_node_id && !(await canAtNode(c, ctx, 'buying:source', e.plant_node_id)))) throw new NotFoundException();
      if (e.status !== 'open') throw new ConflictException('Already resolved');
      if (!b.resolution?.trim()) throw new BadRequestException('A resolution note is required');
      await c.query(`UPDATE exceptions SET status='resolved', resolution=$2, resolved_by=$3, resolved_at=now() WHERE id=$1`, [id, b.resolution, ctx.userId]);
      await audit(c, ctx, 'exception.resolved', 'exception', id, { resolution: b.resolution });
      return { ok: true };
    });
  }
}
